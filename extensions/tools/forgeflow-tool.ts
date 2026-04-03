import * as fs from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text, type Component } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type PipelineDetails, type StageResult, emptyStage, getFinalOutput } from "./types";
import { runAgent } from "./run-agent";

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: any[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
      }
    }
  }
  return items;
}

function formatToolCallShort(name: string, args: Record<string, any>, fg: (c: any, t: string) => string): string {
  switch (name) {
    case "bash": {
      const cmd = (args.command as string) || "...";
      return fg("muted", "$ ") + fg("toolOutput", cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd);
    }
    case "read": return fg("muted", "read ") + fg("accent", (args.file_path || args.path || "...") as string);
    case "write": return fg("muted", "write ") + fg("accent", (args.file_path || args.path || "...") as string);
    case "edit": return fg("muted", "edit ") + fg("accent", (args.file_path || args.path || "...") as string);
    case "grep": return fg("muted", "grep ") + fg("accent", `/${args.pattern || ""}/`);
    case "find": return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string);
    default: return fg("accent", name);
  }
}

function formatUsage(usage: { input: number; output: number; cost: number; turns: number }, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns}t`);
  if (usage.input) parts.push(`↑${usage.input < 1000 ? usage.input : Math.round(usage.input / 1000) + "k"}`);
  if (usage.output) parts.push(`↓${usage.output < 1000 ? usage.output : Math.round(usage.output / 1000) + "k"}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

const ForgeflowParams = Type.Object({
  pipeline: Type.String({
    description: 'Which pipeline to run: "prd-qa", "create-issues", "create-issue", "implement", "implement-all", or "review"',
  }),
  maxIterations: Type.Optional(Type.Number({ description: "Max iterations for prd-qa (default 10)" })),
  issue: Type.Optional(Type.String({ description: "Issue number or description for implement pipeline, or feature idea for create-issue" })),
  target: Type.Optional(Type.String({ description: "PR number or --branch for review pipeline" })),
  skipPlan: Type.Optional(Type.Boolean({ description: "Skip planner, implement directly (default false)" })),
  skipReview: Type.Optional(Type.Boolean({ description: "Skip code review after implementation (default false)" })),
});

export function registerForgeflowTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "forgeflow",
    label: "Forgeflow",
    description: [
      "Run forgeflow pipelines: prd-qa (refine PRD), create-issues (decompose PRD into GitHub issues),",
      "create-issue (single issue from a feature idea), implement (plan→TDD→refactor a single issue),",
      "implement-all (loop through all open issues autonomously), review (deterministic checks→code review→judge).",
      "Each pipeline spawns specialized sub-agents with isolated context.",
    ].join(" "),
    parameters: ForgeflowParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;

      switch (params.pipeline) {
        case "prd-qa":
          return await runPrdQa(cwd, params.maxIterations ?? 10, signal, onUpdate, ctx);
        case "create-issues":
          return await runCreateIssues(cwd, signal, onUpdate, ctx);
        case "create-issue":
          return await runCreateIssue(cwd, params.issue ?? "", signal, onUpdate, ctx);
        case "implement":
          return await runImplement(cwd, params.issue ?? "", signal, onUpdate, ctx, {
            skipPlan: params.skipPlan ?? false,
            skipReview: params.skipReview ?? false,
          });
        case "implement-all":
          return await runImplementAll(cwd, signal, onUpdate, ctx, {
            skipPlan: params.skipPlan ?? false,
            skipReview: params.skipReview ?? false,
          });
        case "review":
          return await runReview(cwd, params.target ?? "", signal, onUpdate, ctx);
        default:
          return {
            content: [{ type: "text", text: `Unknown pipeline: ${params.pipeline}. Use: prd-qa, create-issues, implement, review` }],
            details: { pipeline: params.pipeline, stages: [] } as PipelineDetails,
          };
      }
    },

    renderCall(args, theme) {
      const pipeline = args.pipeline || "?";
      let text = theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", pipeline);
      if (args.issue) text += theme.fg("dim", ` #${args.issue}`);
      if (args.target) text += theme.fg("dim", ` ${args.target}`);
      if (args.maxIterations) text += theme.fg("muted", ` (max ${args.maxIterations})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as PipelineDetails | undefined;
      if (!details || details.stages.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      if (expanded) {
        const container = new Container();
        container.addChild(new Text(
          theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", details.pipeline),
          0, 0
        ));
        container.addChild(new Spacer(1));

        for (const stage of details.stages) {
          const icon = stage.status === "done" ? theme.fg("success", "✓")
            : stage.status === "running" ? theme.fg("warning", "⟳")
            : stage.status === "failed" ? theme.fg("error", "✗")
            : theme.fg("muted", "○");
          container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(stage.name))}`, 0, 0));

          const items = getDisplayItems(stage.messages);
          for (const item of items) {
            if (item.type === "toolCall") {
              container.addChild(new Text(
                "  " + theme.fg("muted", "→ ") + formatToolCallShort(item.name, item.args, theme.fg.bind(theme)),
                0, 0
              ));
            }
          }

          const output = getFinalOutput(stage.messages);
          if (output) {
            container.addChild(new Spacer(1));
            try {
              const { getMarkdownTheme } = require("@mariozechner/pi-coding-agent");
              container.addChild(new Markdown(output.trim(), 0, 0, getMarkdownTheme()));
            } catch {
              container.addChild(new Text(theme.fg("toolOutput", output.slice(0, 500)), 0, 0));
            }
          }

          const usageStr = formatUsage(stage.usage, stage.model);
          if (usageStr) container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
          container.addChild(new Spacer(1));
        }

        return container;
      }

      // Collapsed view
      let text = theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", details.pipeline);
      for (const stage of details.stages) {
        const icon = stage.status === "done" ? theme.fg("success", "✓")
          : stage.status === "running" ? theme.fg("warning", "⟳")
          : stage.status === "failed" ? theme.fg("error", "✗")
          : theme.fg("muted", "○");

        text += `\n  ${icon} ${theme.fg("toolTitle", stage.name)}`;

        if (stage.status === "running") {
          const items = getDisplayItems(stage.messages);
          const last = items.filter((i) => i.type === "toolCall").slice(-3);
          for (const item of last) {
            if (item.type === "toolCall") {
              text += "\n    " + theme.fg("muted", "→ ") + formatToolCallShort(item.name, item.args, theme.fg.bind(theme));
            }
          }
        } else if (stage.status === "done" || stage.status === "failed") {
          const preview = stage.output.split("\n")[0]?.slice(0, 80) || "(no output)";
          text += theme.fg("dim", ` ${preview}`);
          const usageStr = formatUsage(stage.usage, stage.model);
          if (usageStr) text += ` ${theme.fg("dim", usageStr)}`;
        }
      }
      return new Text(text, 0, 0);
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function exec(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = nodeSpawn("bash", ["-c", cmd], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out.trim()));
    proc.on("error", () => resolve(""));
  });
}

interface ResolvedIssue {
  number: number;
  title: string;
  body: string;
  branch: string;
  existingPR?: number;
}

/**
 * Resolve which issue to implement:
 * 1. Explicit issue number provided → fetch it
 * 2. On a feature branch (feat/issue-N) → extract N
 * 3. On main → pick next open auto-generated issue
 *
 * Also checks for existing branch/PR.
 */
async function resolveIssue(cwd: string, issueArg?: string): Promise<ResolvedIssue | string> {
  let issueNum: number;

  if (issueArg && /^\d+$/.test(issueArg)) {
    issueNum = parseInt(issueArg);
  } else if (issueArg) {
    // Non-numeric arg — pass through as description (original behavior)
    return { number: 0, title: issueArg, body: issueArg, branch: "" };
  } else {
    // No arg — detect from branch name
    const branch = await exec("git branch --show-current", cwd);
    const match = branch.match(/(?:feat\/)?issue-(\d+)/);

    if (match) {
      issueNum = parseInt(match[1]);
    } else {
      return `On branch "${branch}" — can't detect issue number. Use /implement <issue#>.`;
    }
  }

  // Fetch issue details
  const issueJson = await exec(
    `gh issue view ${issueNum} --json number,title,body`,
    cwd,
  );
  if (!issueJson) return `Could not fetch issue #${issueNum}.`;

  let issue: { number: number; title: string; body: string };
  try { issue = JSON.parse(issueJson); } catch { return `Could not parse issue #${issueNum}.`; }

  const branch = `feat/issue-${issueNum}`;

  // Check for existing PR
  const prJson = await exec(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  const existingPR = prJson && prJson !== "null" ? parseInt(prJson) : undefined;

  return { ...issue, branch, existingPR };
}

// ─── Pipeline implementations ───────────────────────────────────────

async function runPrdQa(
  cwd: string, maxIterations: number, signal: AbortSignal, onUpdate: any, ctx: any
) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return { content: [{ type: "text" as const, text: "PRD.md not found." }], details: { pipeline: "prd-qa", stages: [] } };
  }

  const stages: StageResult[] = [];
  const opts = { cwd, signal, stages, pipeline: "prd-qa", onUpdate };

  for (let i = 1; i <= maxIterations; i++) {
    // Critic
    stages.push(emptyStage("prd-critic"));
    const criticResult = await runAgent("prd-critic",
      "Review PRD.md for completeness. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
      { ...opts, tools: ["read", "write", "bash", "grep", "find"] });

    // No QUESTIONS.md = critic considers PRD complete
    if (!fs.existsSync(`${cwd}/QUESTIONS.md`)) {
      if (criticResult.status === "failed") {
        return {
          content: [{ type: "text" as const, text: `Critic failed.\nStderr: ${criticResult.stderr.slice(0, 300)}` }],
          details: { pipeline: "prd-qa", stages },
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: "PRD refinement complete. Ready for /create-issues." }],
        details: { pipeline: "prd-qa", stages },
      };
    }

    // Architect
    stages.push(emptyStage("prd-architect"));
    await runAgent("prd-architect",
      "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
      { ...opts, tools: ["read", "write", "edit", "bash", "grep", "find"] });

    // Integrator — incorporate answers into PRD before approval gate
    stages.push(emptyStage("prd-integrator"));
    await runAgent("prd-integrator",
      "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
      opts);

    // Approval gate — show PRD in editor, user can review/edit then decide
    if (ctx.hasUI) {
      const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
      const edited = await ctx.ui.editor(`Iteration ${i} — Review PRD (edit or close to continue)`, prdContent);

      // If user edited, write changes back
      if (edited != null && edited !== prdContent) {
        fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
      }

      const action = await ctx.ui.select(
        "PRD updated. What next?",
        ["Continue refining", "Accept PRD"]
      );
      if (action === "Accept PRD" || action == null) {
        return {
          content: [{ type: "text" as const, text: "PRD accepted." }],
          details: { pipeline: "prd-qa", stages },
        };
      }
    }
  }

  return {
    content: [{ type: "text" as const, text: `PRD refinement did not complete after ${maxIterations} iterations.` }],
    details: { pipeline: "prd-qa", stages },
  };
}

async function runCreateIssue(cwd: string, idea: string, signal: AbortSignal, onUpdate: any, ctx: any) {
  if (!idea) {
    return { content: [{ type: "text" as const, text: "No feature idea provided." }], details: { pipeline: "create-issue", stages: [] } };
  }

  const stages: StageResult[] = [emptyStage("single-issue-creator")];
  const opts = { cwd, signal, stages, pipeline: "create-issue", onUpdate };

  await runAgent("single-issue-creator", idea,
    { ...opts, tools: ["read", "write", "bash", "grep", "find"] });

  return {
    content: [{ type: "text" as const, text: "Issue created." }],
    details: { pipeline: "create-issue", stages },
  };
}

async function runCreateIssues(cwd: string, signal: AbortSignal, onUpdate: any, ctx: any) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return { content: [{ type: "text" as const, text: "PRD.md not found." }], details: { pipeline: "create-issues", stages: [] } };
  }

  const stages: StageResult[] = [emptyStage("issue-creator")];
  const opts = { cwd, signal, stages, pipeline: "create-issues", onUpdate };

  await runAgent("issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
    { ...opts, tools: ["read", "write", "bash", "grep", "find"] });

  return {
    content: [{ type: "text" as const, text: "Issue creation complete." }],
    details: { pipeline: "create-issues", stages },
  };
}

async function runImplement(
  cwd: string, issueArg: string, signal: AbortSignal, onUpdate: any, ctx: any,
  flags: { skipPlan: boolean; skipReview: boolean } = { skipPlan: false, skipReview: false },
) {
  // Resolve issue: explicit arg, branch detection, or next open issue
  const resolved = await resolveIssue(cwd, issueArg || undefined);
  if (typeof resolved === "string") {
    return { content: [{ type: "text" as const, text: resolved }], details: { pipeline: "implement", stages: [] } };
  }

  const issueLabel = resolved.number
    ? `#${resolved.number}: ${resolved.title}`
    : resolved.title;
  const issueContext = resolved.number
    ? `Issue #${resolved.number}: ${resolved.title}\n\n${resolved.body}`
    : resolved.body;

  const stageList: StageResult[] = [];
  if (!flags.skipPlan) stageList.push(emptyStage("planner"));
  stageList.push(emptyStage("implementor"), emptyStage("refactorer"));
  const stages = stageList;
  const opts = { cwd, signal, stages, pipeline: "implement", onUpdate };

  let plan = "";

  if (!flags.skipPlan) {
    const planResult = await runAgent("planner",
      `Plan the implementation for this issue by producing a sequenced list of test cases.\n\n${issueContext}`,
      { ...opts, tools: ["read", "bash", "grep", "find"] });

    if (planResult.status === "failed") {
      return {
        content: [{ type: "text" as const, text: `Planner failed: ${planResult.output}` }],
        details: { pipeline: "implement", stages },
        isError: true,
      };
    }
    plan = planResult.output;

    // Interactive mode: let user review/edit the plan before proceeding
    if (ctx.hasUI && plan) {
      const edited = await ctx.ui.editor(`Review implementation plan for ${issueLabel}`, plan);
      if (edited != null && edited !== plan) {
        plan = edited;
      }

      const action = await ctx.ui.select(
        "Plan ready. What next?",
        ["Approve and implement", "Cancel"]
      );
      if (action === "Cancel" || action == null) {
        return {
          content: [{ type: "text" as const, text: "Implementation cancelled." }],
          details: { pipeline: "implement", stages },
        };
      }
    }
  }

  // Create/checkout feature branch if on main
  if (resolved.branch) {
    const currentBranch = await exec("git branch --show-current", cwd);
    if (currentBranch === "main" || currentBranch === "master") {
      const branchExists = await exec(`git rev-parse --verify ${resolved.branch} 2>/dev/null && echo yes || echo no`, cwd);
      if (branchExists === "yes") {
        await exec(`git checkout ${resolved.branch}`, cwd);
      } else {
        await exec(`git checkout -b ${resolved.branch}`, cwd);
      }
    }
  }

  // Clean up stale blockers
  try { fs.unlinkSync(`${cwd}/BLOCKED.md`); } catch {}

  // Implementor
  const planSection = plan ? `\n\nIMPLEMENTATION PLAN:\n${plan}` : "";
  const branchNote = resolved.branch ? `\n- You should be on branch: ${resolved.branch} — do NOT create or switch branches.` : "\n- Do NOT create or switch branches.";
  const prNote = resolved.existingPR ? `\n- PR #${resolved.existingPR} already exists for this branch.` : "";
  const closeNote = resolved.number ? `\n- The PR body MUST include 'Closes #${resolved.number}' so the issue auto-closes on merge.` : "";

  await runAgent("implementor",
    `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit, push, and create a PR.\n\nCONSTRAINTS:${branchNote}${prNote}${closeNote}\n- If blocked, write BLOCKED.md with the reason and stop.`,
    { ...opts, tools: ["read", "write", "edit", "bash", "grep", "find"] });

  // Check for blocker
  if (fs.existsSync(`${cwd}/BLOCKED.md`)) {
    const reason = fs.readFileSync(`${cwd}/BLOCKED.md`, "utf-8");
    return {
      content: [{ type: "text" as const, text: `Implementor blocked:\n${reason}` }],
      details: { pipeline: "implement", stages },
      isError: true,
    };
  }

  // Refactorer
  await runAgent("refactorer",
    "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit if changed.",
    { ...opts, tools: ["read", "write", "edit", "bash", "grep", "find"] });

  // Review (unless skipped)
  if (!flags.skipReview) {
    const reviewResult = await runReviewInline(cwd, signal, onUpdate, ctx, stages);
    if (reviewResult.isError) {
      return { ...reviewResult, details: { pipeline: "implement", stages } };
    }
  }

  return {
    content: [{ type: "text" as const, text: `Implementation of ${issueLabel} complete.` }],
    details: { pipeline: "implement", stages },
  };
}

// ─── Implement-all loop ─────────────────────────────────────────────

interface IssueInfo { number: number; title: string; body: string; }

/**
 * Get issue numbers whose dependencies (referenced as #N in ## Dependencies section) are satisfied.
 */
function getReadyIssues(issues: IssueInfo[], completed: Set<number>): number[] {
  return issues.filter((issue) => {
    const depMatch = issue.body.split("## Dependencies");
    if (depMatch.length < 2) return true; // no deps section
    const depSection = depMatch[1].split("\n## ")[0];
    const deps = [...depSection.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1]));
    return deps.every((d) => completed.has(d));
  }).map((i) => i.number);
}

async function runImplementAll(
  cwd: string, signal: AbortSignal, onUpdate: any, ctx: any,
  flags: { skipPlan: boolean; skipReview: boolean },
) {
  const allStages: StageResult[] = [];

  // Seed completed set with already-closed issues
  const closedJson = await exec(
    `gh issue list --state closed --label "auto-generated" --json number --jq '.[].number'`, cwd,
  );
  const completed = new Set<number>(
    closedJson ? closedJson.split("\n").filter(Boolean).map(Number) : [],
  );

  let iteration = 0;
  const maxIterations = 50; // safety cap

  while (iteration++ < maxIterations) {
    if (signal.aborted) break;

    // Return to main and pull
    await exec("git checkout main && git pull --rebase", cwd);

    // Fetch open issues
    const issuesJson = await exec(
      `gh issue list --state open --label "auto-generated" --json number,title,body --jq 'sort_by(.number)'`, cwd,
    );
    let issues: IssueInfo[];
    try { issues = JSON.parse(issuesJson || "[]"); } catch { issues = []; }

    if (issues.length === 0) {
      return {
        content: [{ type: "text" as const, text: "All issues implemented." }],
        details: { pipeline: "implement-all", stages: allStages },
      };
    }

    // Find ready issues (deps satisfied)
    const ready = getReadyIssues(issues, completed);
    if (ready.length === 0) {
      return {
        content: [{ type: "text" as const, text: `${issues.length} issues remain but all have unresolved dependencies.` }],
        details: { pipeline: "implement-all", stages: allStages },
        isError: true,
      };
    }

    const issueNum = ready[0];
    const issue = issues.find((i) => i.number === issueNum)!;

    // Run implement for this issue (reuses full implement pipeline)
    allStages.push(emptyStage(`implement-${issueNum}`));
    const implResult = await runImplement(cwd, String(issueNum), signal, onUpdate, ctx, flags);

    // Update stage status
    const implStage = allStages.find((s) => s.name === `implement-${issueNum}`);
    if (implStage) {
      implStage.status = implResult.isError ? "failed" : "done";
      implStage.output = implResult.content[0]?.type === "text" ? implResult.content[0].text : "";
    }

    if (implResult.isError) {
      return {
        content: [{ type: "text" as const, text: `Failed on issue #${issueNum}: ${implResult.content[0]?.type === "text" ? implResult.content[0].text : "unknown error"}` }],
        details: { pipeline: "implement-all", stages: allStages },
        isError: true,
      };
    }

    // Check for PR and merge
    const branch = `feat/issue-${issueNum}`;
    await exec("git checkout main && git pull --rebase", cwd);
    const prNum = await exec(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);

    if (prNum && prNum !== "null") {
      const mergeResult = await exec(`gh pr merge ${prNum} --squash --delete-branch`, cwd);
      if (mergeResult.includes("Merged") || mergeResult === "") {
        // gh pr merge returns empty on success in some versions
        completed.add(issueNum);
      } else {
        // Try to check if it actually merged
        const prState = await exec(`gh pr view ${prNum} --json state --jq '.state'`, cwd);
        if (prState === "MERGED") {
          completed.add(issueNum);
        } else {
          return {
            content: [{ type: "text" as const, text: `Failed to merge PR #${prNum} for issue #${issueNum}.` }],
            details: { pipeline: "implement-all", stages: allStages },
            isError: true,
          };
        }
      }
    } else {
      return {
        content: [{ type: "text" as const, text: `No PR found for issue #${issueNum} after implementation.` }],
        details: { pipeline: "implement-all", stages: allStages },
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text" as const, text: `Reached max iterations (${maxIterations}).` }],
    details: { pipeline: "implement-all", stages: allStages },
  };
}

/**
 * Shared review logic — used by both standalone /review and chained from /implement.
 * Appends code-reviewer + review-judge stages to the provided stages array.
 */
async function runReviewInline(
  cwd: string, signal: AbortSignal, onUpdate: any, ctx: any,
  stages: StageResult[], diffCmd = "git diff main...HEAD", pipeline = "review",
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const diff = await new Promise<string>((resolve) => {
    const proc = nodeSpawn("bash", ["-c", diffCmd], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out.trim()));
    proc.on("error", () => resolve(""));
  });

  if (!diff) {
    return { content: [{ type: "text", text: "No changes to review." }] };
  }

  const opts = { cwd, signal, stages, pipeline, onUpdate };

  // Clean up stale findings
  try { fs.unlinkSync(`${cwd}/FINDINGS.md`); } catch {}

  // Code reviewer
  stages.push(emptyStage("code-reviewer"));
  await runAgent("code-reviewer",
    `Review the following diff:\n\n${diff}`,
    { ...opts, tools: ["read", "write", "bash", "grep", "find"] });

  if (!fs.existsSync(`${cwd}/FINDINGS.md`)) {
    return { content: [{ type: "text", text: "Review passed — no actionable findings." }] };
  }

  // Review judge
  stages.push(emptyStage("review-judge"));
  const findings = fs.readFileSync(`${cwd}/FINDINGS.md`, "utf-8");
  await runAgent("review-judge",
    `Validate the following code review findings against the actual code:\n\n${findings}`,
    { ...opts, tools: ["read", "write", "bash", "grep", "find"] });

  if (!fs.existsSync(`${cwd}/FINDINGS.md`)) {
    return { content: [{ type: "text", text: "Review passed — judge filtered all findings." }] };
  }

  const validatedFindings = fs.readFileSync(`${cwd}/FINDINGS.md`, "utf-8");
  return { content: [{ type: "text", text: validatedFindings }], isError: true };
}

async function runReview(cwd: string, target: string, signal: AbortSignal, onUpdate: any, ctx: any) {
  const stages: StageResult[] = [];

  let diffCmd = "git diff main...HEAD";
  if (target.match(/^\d+$/)) diffCmd = `gh pr diff ${target}`;
  else if (target.startsWith("--branch")) {
    const branch = target.replace("--branch", "").trim() || "HEAD";
    diffCmd = `git diff main...${branch}`;
  }

  const result = await runReviewInline(cwd, signal, onUpdate, ctx, stages, diffCmd);
  return { ...result, details: { pipeline: "review", stages } };
}
