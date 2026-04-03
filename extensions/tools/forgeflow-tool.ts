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
    description: 'Which pipeline to run: "prd-qa", "create-issues", "create-issue", "implement", or "review"',
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
      "create-issue (single issue from a feature idea), implement (plan→TDD→refactor an issue), review (deterministic checks→code review→judge).",
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
    // No arg — detect from branch or pick next open issue
    const branch = await exec("git branch --show-current", cwd);
    const match = branch.match(/(?:feat\/)?issue-(\d+)/);

    if (match) {
      issueNum = parseInt(match[1]);
    } else if (branch === "main" || branch === "master") {
      // Pick next open auto-generated issue
      const next = await exec(
        `gh issue list --state open --label "auto-generated" --json number --jq 'sort_by(.number) | .[0].number'`,
        cwd,
      );
      if (!next || next === "null") {
        return "No open auto-generated issues found.";
      }
      issueNum = parseInt(next);
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

  // Interactive mode: create feature branch if not already on one
  if (ctx.hasUI && resolved.branch) {
    const currentBranch = await exec("git branch --show-current", cwd);
    if (currentBranch !== resolved.branch) {
      // Check if branch exists, create or checkout
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
    `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit changes.\n\nCONSTRAINTS:${branchNote}${prNote}${closeNote}\n- If blocked, write BLOCKED.md with the reason and stop.`,
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
