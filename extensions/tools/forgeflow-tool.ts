import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { runAgent } from "./run-agent";
import { type AnyCtx, emptyStage, getFinalOutput, type PipelineDetails, type StageResult, sumUsage } from "./types";

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

interface ForgeflowInput {
  pipeline: string;
  maxIterations?: number;
  issue?: string;
  target?: string;
  skipPlan?: boolean;
  skipReview?: boolean;
}

function getDisplayItems(messages: AnyCtx[]): DisplayItem[] {
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

function formatToolCallShort(
  name: string,
  args: Record<string, unknown>,
  fg: (c: string, t: string) => string,
): string {
  switch (name) {
    case "bash": {
      const cmd = (args.command as string) || "...";
      return fg("muted", "$ ") + fg("toolOutput", cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd);
    }
    case "read":
      return fg("muted", "read ") + fg("accent", (args.file_path || args.path || "...") as string);
    case "write":
      return fg("muted", "write ") + fg("accent", (args.file_path || args.path || "...") as string);
    case "edit":
      return fg("muted", "edit ") + fg("accent", (args.file_path || args.path || "...") as string);
    case "grep":
      return fg("muted", "grep ") + fg("accent", `/${args.pattern || ""}/`);
    case "find":
      return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string);
    default:
      return fg("accent", name);
  }
}

function formatUsage(usage: { input: number; output: number; cost: number; turns: number }, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns}t`);
  if (usage.input) parts.push(`↑${usage.input < 1000 ? usage.input : `${Math.round(usage.input / 1000)}k`}`);
  if (usage.output) parts.push(`↓${usage.output < 1000 ? usage.output : `${Math.round(usage.output / 1000)}k`}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

const ForgeflowParams = Type.Object({
  pipeline: Type.String({
    description:
      'Which pipeline to run: "prd-qa", "create-issues", "create-issue", "implement", "implement-all", or "review"',
  }),
  maxIterations: Type.Optional(Type.Number({ description: "Max iterations for prd-qa (default 10)" })),
  issue: Type.Optional(
    Type.String({
      description: "Issue number or description for implement pipeline, or feature idea for create-issue",
    }),
  ),
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
    parameters: ForgeflowParams as AnyCtx,

    async execute(
      _toolCallId: string,
      _params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: AnyCtx,
      ctx: AnyCtx,
    ) {
      const params = _params as ForgeflowInput;
      const cwd = ctx.cwd as string;
      const sig = signal ?? new AbortController().signal;

      try {
        switch (params.pipeline) {
          case "prd-qa":
            return await runPrdQa(cwd, params.maxIterations ?? 10, sig, onUpdate, ctx);
          case "create-issues":
            return await runCreateIssues(cwd, sig, onUpdate, ctx);
          case "create-issue":
            return await runCreateIssue(cwd, params.issue ?? "", sig, onUpdate, ctx);
          case "implement":
            return await runImplement(cwd, params.issue ?? "", sig, onUpdate, ctx, {
              skipPlan: params.skipPlan ?? false,
              skipReview: params.skipReview ?? false,
            });
          case "implement-all":
            return await runImplementAll(cwd, sig, onUpdate, ctx, {
              skipPlan: params.skipPlan ?? false,
              skipReview: params.skipReview ?? false,
            });
          case "review":
            return await runReview(cwd, params.target ?? "", sig, onUpdate, ctx);
          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown pipeline: ${params.pipeline}. Use: prd-qa, create-issues, implement, review`,
                },
              ],
              details: { pipeline: params.pipeline, stages: [] } as PipelineDetails,
            };
        }
      } finally {
        setForgeflowStatus(ctx, undefined);
        setForgeflowWidget(ctx, undefined);
      }
    },

    renderCall(_args: unknown, theme: AnyCtx) {
      const args = _args as ForgeflowInput;
      const pipeline = args.pipeline || "?";
      let text = theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", pipeline);
      if (args.issue) text += theme.fg("dim", ` #${args.issue}`);
      if (args.target) text += theme.fg("dim", ` ${args.target}`);
      if (args.maxIterations) text += theme.fg("muted", ` (max ${args.maxIterations})`);
      return new Text(text, 0, 0);
    },

    renderResult(result: AnyCtx, { expanded }: { expanded: boolean }, theme: AnyCtx) {
      const details = result.details as PipelineDetails | undefined;
      if (!details || details.stages.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      if (expanded) {
        const container = new Container();
        container.addChild(
          new Text(theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", details.pipeline), 0, 0),
        );
        container.addChild(new Spacer(1));

        for (const stage of details.stages) {
          const icon =
            stage.status === "done"
              ? theme.fg("success", "✓")
              : stage.status === "running"
                ? theme.fg("warning", "⟳")
                : stage.status === "failed"
                  ? theme.fg("error", "✗")
                  : theme.fg("muted", "○");
          container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(stage.name))}`, 0, 0));

          const items = getDisplayItems(stage.messages);
          for (const item of items) {
            if (item.type === "toolCall") {
              container.addChild(
                new Text(
                  `  ${theme.fg("muted", "→ ")}${formatToolCallShort(item.name, item.args, theme.fg.bind(theme))}`,
                  0,
                  0,
                ),
              );
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
        const icon =
          stage.status === "done"
            ? theme.fg("success", "✓")
            : stage.status === "running"
              ? theme.fg("warning", "⟳")
              : stage.status === "failed"
                ? theme.fg("error", "✗")
                : theme.fg("muted", "○");

        text += `\n  ${icon} ${theme.fg("toolTitle", stage.name)}`;

        if (stage.status === "running") {
          const items = getDisplayItems(stage.messages);
          const last = items.filter((i) => i.type === "toolCall").slice(-3);
          for (const item of last) {
            if (item.type === "toolCall") {
              text += `\n    ${theme.fg("muted", "→ ")}${formatToolCallShort(item.name, item.args, theme.fg.bind(theme))}`;
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
    proc.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.on("close", () => resolve(out.trim()));
    proc.on("error", () => resolve(""));
  });
}

function setForgeflowStatus(ctx: AnyCtx, text: string | undefined): void {
  if (ctx.hasUI) ctx.ui.setStatus("forgeflow", text);
}

function setForgeflowWidget(ctx: AnyCtx, lines: string[] | undefined): void {
  if (ctx.hasUI) ctx.ui.setWidget("forgeflow", lines);
}

function updateProgressWidget(
  ctx: AnyCtx,
  progress: Map<number, { title: string; status: string }>,
  totalCost: number,
): void {
  let done = 0;
  for (const [, info] of progress) {
    if (info.status === "done") done++;
  }
  let header = `implement-all · ${done}/${progress.size}`;
  if (totalCost > 0) header += ` · $${totalCost.toFixed(2)}`;
  const lines: string[] = [header];
  for (const [num, info] of progress) {
    const icon = info.status === "done" ? "✓" : info.status === "running" ? "⟳" : info.status === "failed" ? "✗" : "○";
    const title = info.title.length > 50 ? `${info.title.slice(0, 50)}...` : info.title;
    lines.push(`  ${icon} #${num} ${title}`);
  }
  setForgeflowWidget(ctx, lines);
}

/**
 * Run review and fix any findings via implementor. Returns true if findings were found and fixed.
 */
async function reviewAndFix(
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  stages: StageResult[],
  pipeline = "implement",
): Promise<void> {
  const reviewResult = await runReviewInline(cwd, signal, onUpdate, ctx, stages);
  if (reviewResult.isError) {
    const findings = reviewResult.content[0]?.type === "text" ? reviewResult.content[0].text : "";
    stages.push(emptyStage("fix-findings"));
    await runAgent(
      "implementor",
      `Fix the following code review findings:\n\n${findings}\n\nRULES:\n- Fix only the cited issues. Do not refactor or improve unrelated code.\n- Run the check command after fixes.\n- Commit and push the fixes.`,
      { cwd, signal, stages, pipeline, onUpdate, tools: TOOLS_ALL },
    );
    try {
      fs.unlinkSync(`${cwd}/FINDINGS.md`);
    } catch {}
  }
}

/**
 * Run refactorer then review+fix. Shared by fresh implementation and resume-from-branch paths.
 */
async function refactorAndReview(
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  stages: StageResult[],
  skipReview: boolean,
  pipeline = "implement",
): Promise<void> {
  if (!stages.some((s) => s.name === "refactorer")) stages.push(emptyStage("refactorer"));
  await runAgent(
    "refactorer",
    "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit and push if changed.",
    { cwd, signal, stages, pipeline, onUpdate, tools: TOOLS_ALL },
  );

  if (!skipReview) {
    await reviewAndFix(cwd, signal, onUpdate, ctx, stages, pipeline);
  }
}

const TOOLS_ALL = ["read", "write", "edit", "bash", "grep", "find"];
const TOOLS_READONLY = ["read", "bash", "grep", "find"];
const TOOLS_NO_EDIT = ["read", "write", "bash", "grep", "find"];

/**
 * Checkout a branch, creating it if it doesn't exist.
 */
async function ensureBranch(cwd: string, branch: string): Promise<void> {
  const currentBranch = await exec("git branch --show-current", cwd);
  if (currentBranch === branch) return;
  const exists = await exec(`git rev-parse --verify ${branch} 2>/dev/null && echo yes || echo no`, cwd);
  if (exists === "yes") {
    await exec(`git checkout ${branch}`, cwd);
  } else {
    await exec(`git checkout -b ${branch}`, cwd);
  }
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
    issueNum = parseInt(issueArg, 10);
  } else if (issueArg) {
    // Non-numeric arg — pass through as description (original behavior)
    return { number: 0, title: issueArg, body: issueArg, branch: "" };
  } else {
    // No arg — detect from branch name
    const branch = await exec("git branch --show-current", cwd);
    const match = branch.match(/(?:feat\/)?issue-(\d+)/);

    if (match) {
      // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
      issueNum = parseInt(match[1]!, 10);
    } else {
      return `On branch "${branch}" — can't detect issue number. Use /implement <issue#>.`;
    }
  }

  // Fetch issue details
  const issueJson = await exec(`gh issue view ${issueNum} --json number,title,body`, cwd);
  if (!issueJson) return `Could not fetch issue #${issueNum}.`;

  let issue: { number: number; title: string; body: string };
  try {
    issue = JSON.parse(issueJson);
  } catch {
    return `Could not parse issue #${issueNum}.`;
  }

  const branch = `feat/issue-${issueNum}`;

  // Check for existing PR
  const prJson = await exec(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  const existingPR = prJson && prJson !== "null" ? parseInt(prJson, 10) : undefined;

  return { ...issue, branch, existingPR };
}

// ─── Pipeline implementations ───────────────────────────────────────

async function runPrdQa(cwd: string, maxIterations: number, signal: AbortSignal, onUpdate: AnyCtx, ctx: AnyCtx) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "prd-qa", stages: [] },
    };
  }

  const stages: StageResult[] = [];
  const opts = { cwd, signal, stages, pipeline: "prd-qa", onUpdate };

  for (let i = 1; i <= maxIterations; i++) {
    // Critic
    stages.push(emptyStage("prd-critic"));
    const criticResult = await runAgent(
      "prd-critic",
      "Review PRD.md for completeness. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
      { ...opts, tools: TOOLS_NO_EDIT },
    );

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
    await runAgent(
      "prd-architect",
      "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
      { ...opts, tools: TOOLS_ALL },
    );

    // Integrator — incorporate answers into PRD before approval gate
    stages.push(emptyStage("prd-integrator"));
    await runAgent(
      "prd-integrator",
      "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
      opts,
    );

    // Approval gate — show PRD in editor, user can review/edit then decide
    if (ctx.hasUI) {
      const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
      const edited = await ctx.ui.editor(`Iteration ${i} — Review PRD (edit or close to continue)`, prdContent);

      // If user edited, write changes back
      if (edited != null && edited !== prdContent) {
        fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
      }

      const action = await ctx.ui.select("PRD updated. What next?", ["Continue refining", "Accept PRD"]);
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

async function runCreateIssue(cwd: string, idea: string, signal: AbortSignal, onUpdate: AnyCtx, _ctx: AnyCtx) {
  if (!idea) {
    return {
      content: [{ type: "text" as const, text: "No feature idea provided." }],
      details: { pipeline: "create-issue", stages: [] },
    };
  }

  const stages: StageResult[] = [emptyStage("single-issue-creator")];
  const opts = { cwd, signal, stages, pipeline: "create-issue", onUpdate };

  await runAgent("single-issue-creator", idea, { ...opts, tools: TOOLS_NO_EDIT });

  return {
    content: [{ type: "text" as const, text: "Issue created." }],
    details: { pipeline: "create-issue", stages },
  };
}

async function runCreateIssues(cwd: string, signal: AbortSignal, onUpdate: AnyCtx, _ctx: AnyCtx) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "create-issues", stages: [] },
    };
  }

  const stages: StageResult[] = [emptyStage("issue-creator")];
  const opts = { cwd, signal, stages, pipeline: "create-issues", onUpdate };

  await runAgent(
    "issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  return {
    content: [{ type: "text" as const, text: "Issue creation complete." }],
    details: { pipeline: "create-issues", stages },
  };
}

async function runImplement(
  cwd: string,
  issueArg: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  flags: { skipPlan: boolean; skipReview: boolean; autonomous?: boolean } = { skipPlan: false, skipReview: false },
) {
  const interactive = ctx.hasUI && !flags.autonomous;
  // Resolve issue: explicit arg, branch detection, or next open issue
  const resolved = await resolveIssue(cwd, issueArg || undefined);
  if (typeof resolved === "string") {
    return { content: [{ type: "text" as const, text: resolved }], details: { pipeline: "implement", stages: [] } };
  }

  const issueLabel = resolved.number ? `#${resolved.number}: ${resolved.title}` : resolved.title;

  // Status line for standalone /implement (implement-all manages its own)
  if (!flags.autonomous && resolved.number) {
    setForgeflowStatus(ctx, `#${resolved.number} ${resolved.title} · ${resolved.branch}`);
  }

  const issueContext = resolved.number
    ? `Issue #${resolved.number}: ${resolved.title}\n\n${resolved.body}`
    : resolved.body;

  // --- Resumability: skip to review if work already exists ---
  if (resolved.existingPR) {
    // PR exists — skip straight to review
    const stages: StageResult[] = [];
    if (!flags.skipReview) {
      await reviewAndFix(cwd, signal, onUpdate, ctx, stages);
    }
    return {
      content: [{ type: "text" as const, text: `Resumed ${issueLabel} — PR #${resolved.existingPR} already exists.` }],
      details: { pipeline: "implement", stages },
    };
  }

  if (resolved.branch) {
    // Check if branch exists with commits but no PR (killed before push)
    const branchExists = await exec(
      `git rev-parse --verify ${resolved.branch} 2>/dev/null && echo yes || echo no`,
      cwd,
    );
    if (branchExists === "yes") {
      await ensureBranch(cwd, resolved.branch);
      const ahead = await exec(`git rev-list main..${resolved.branch} --count`, cwd);
      if (parseInt(ahead, 10) > 0) {
        // Has commits — push and create PR
        await exec(`git push -u origin ${resolved.branch}`, cwd);
        const closeRef = resolved.number ? `Closes #${resolved.number}` : "";
        await exec(`gh pr create --title "${resolved.title}" --body "${closeRef}" --head ${resolved.branch}`, cwd);

        const stages: StageResult[] = [];
        await refactorAndReview(cwd, signal, onUpdate, ctx, stages, flags.skipReview);
        return {
          content: [{ type: "text" as const, text: `Resumed ${issueLabel} — pushed existing commits and created PR.` }],
          details: { pipeline: "implement", stages },
        };
      }
    }
  }

  // --- Fresh implementation ---
  const stageList: StageResult[] = [];
  if (!flags.skipPlan) stageList.push(emptyStage("planner"));
  stageList.push(emptyStage("implementor"));
  stageList.push(emptyStage("refactorer"));
  const stages = stageList;
  const opts = { cwd, signal, stages, pipeline: "implement", onUpdate };

  let plan = "";

  if (!flags.skipPlan) {
    const planResult = await runAgent(
      "planner",
      `Plan the implementation for this issue by producing a sequenced list of test cases.\n\n${issueContext}`,
      { ...opts, tools: TOOLS_READONLY },
    );

    if (planResult.status === "failed") {
      return {
        content: [{ type: "text" as const, text: `Planner failed: ${planResult.output}` }],
        details: { pipeline: "implement", stages },
        isError: true,
      };
    }
    plan = planResult.output;

    // Interactive mode: let user review/edit the plan before proceeding
    if (interactive && plan) {
      const edited = await ctx.ui.editor(`Review implementation plan for ${issueLabel}`, plan);
      if (edited != null && edited !== plan) {
        plan = edited;
      }

      const action = await ctx.ui.select("Plan ready. What next?", ["Approve and implement", "Cancel"]);
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
      await ensureBranch(cwd, resolved.branch);
    }
  }

  // Clean up stale blockers
  try {
    fs.unlinkSync(`${cwd}/BLOCKED.md`);
  } catch {}

  // Implementor
  const planSection = plan ? `\n\nIMPLEMENTATION PLAN:\n${plan}` : "";
  const branchNote = resolved.branch
    ? `\n- You should be on branch: ${resolved.branch} — do NOT create or switch branches.`
    : "\n- Do NOT create or switch branches.";
  const prNote = resolved.existingPR ? `\n- PR #${resolved.existingPR} already exists for this branch.` : "";
  const closeNote = resolved.number
    ? `\n- The PR body MUST include 'Closes #${resolved.number}' so the issue auto-closes on merge.`
    : "";
  const unresolvedNote = flags.autonomous
    ? `\n- If the plan has unresolved questions, resolve them yourself using sensible defaults. Do NOT stop and wait.`
    : "";

  await runAgent(
    "implementor",
    `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit, push, and create a PR.\n\nCONSTRAINTS:${branchNote}${prNote}${closeNote}${unresolvedNote}\n- If blocked, write BLOCKED.md with the reason and stop.`,
    { ...opts, tools: TOOLS_ALL },
  );

  // Check for blocker
  if (fs.existsSync(`${cwd}/BLOCKED.md`)) {
    const reason = fs.readFileSync(`${cwd}/BLOCKED.md`, "utf-8");
    return {
      content: [{ type: "text" as const, text: `Implementor blocked:\n${reason}` }],
      details: { pipeline: "implement", stages },
      isError: true,
    };
  }

  // Refactor + review
  await refactorAndReview(cwd, signal, onUpdate, ctx, stages, flags.skipReview);

  // Ensure PR exists — agent may have skipped or failed `gh pr create`
  if (resolved.branch) {
    await exec(`git push -u origin ${resolved.branch}`, cwd);
    const existingPR = await exec(`gh pr list --head "${resolved.branch}" --json number --jq '.[0].number'`, cwd);
    if (!existingPR || existingPR === "null") {
      const closeRef = resolved.number ? `Closes #${resolved.number}` : "";
      await exec(`gh pr create --title "${resolved.title}" --body "${closeRef}" --head ${resolved.branch}`, cwd);
    }
  }

  return {
    content: [{ type: "text" as const, text: `Implementation of ${issueLabel} complete.` }],
    details: { pipeline: "implement", stages },
  };
}

// ─── Implement-all loop ─────────────────────────────────────────────

interface IssueInfo {
  number: number;
  title: string;
  body: string;
}

/**
 * Get issue numbers whose dependencies (referenced as #N in ## Dependencies section) are satisfied.
 */
function getReadyIssues(issues: IssueInfo[], completed: Set<number>): number[] {
  return issues
    .filter((issue) => {
      if (completed.has(issue.number)) return false; // already done (guards against API eventual consistency)
      const parts = issue.body.split("## Dependencies");
      if (parts.length < 2) return true; // no deps section
      const depSection = parts[1]?.split("\n## ")[0] ?? "";
      const deps = [...depSection.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1] ?? "0", 10));
      return deps.every((d) => completed.has(d));
    })
    .map((i) => i.number);
}

async function runImplementAll(
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  flags: { skipPlan: boolean; skipReview: boolean },
) {
  const allStages: StageResult[] = [];
  const issueProgress = new Map<number, { title: string; status: "pending" | "running" | "done" | "failed" }>();

  // Seed completed set with already-closed issues
  const closedJson = await exec(
    `gh issue list --state closed --label "auto-generated" --json number --jq '.[].number'`,
    cwd,
  );
  const completed = new Set<number>(closedJson ? closedJson.split("\n").filter(Boolean).map(Number) : []);

  let iteration = 0;
  const maxIterations = 50; // safety cap

  while (iteration++ < maxIterations) {
    if (signal.aborted) break;

    // Return to main and pull
    await exec("git checkout main && git pull --rebase", cwd);

    // Fetch open issues
    const issuesJson = await exec(
      `gh issue list --state open --label "auto-generated" --json number,title,body --jq 'sort_by(.number)'`,
      cwd,
    );
    let issues: IssueInfo[];
    try {
      issues = JSON.parse(issuesJson || "[]");
    } catch {
      issues = [];
    }

    if (issues.length === 0) {
      return {
        content: [{ type: "text" as const, text: "All issues implemented." }],
        details: { pipeline: "implement-all", stages: allStages },
      };
    }

    // Track all known issues in progress widget
    for (const issue of issues) {
      if (!issueProgress.has(issue.number)) {
        issueProgress.set(issue.number, { title: issue.title, status: "pending" });
      }
    }

    // Find ready issues (deps satisfied)
    const ready = getReadyIssues(issues, completed);
    if (ready.length === 0) {
      return {
        content: [
          { type: "text" as const, text: `${issues.length} issues remain but all have unresolved dependencies.` },
        ],
        details: { pipeline: "implement-all", stages: allStages },
        isError: true,
      };
    }

    // biome-ignore lint/style/noNonNullAssertion: ready is non-empty (checked above)
    const issueNum = ready[0]!;
    const issueTitle = issues.find((i) => i.number === issueNum)?.title ?? `#${issueNum}`;

    // Update status + widget
    issueProgress.set(issueNum, { title: issueTitle, status: "running" });
    setForgeflowStatus(
      ctx,
      `implement-all · ${completed.size}/${completed.size + issues.length} · #${issueNum} ${issueTitle}`,
    );
    updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);

    // Run implement for this issue (reuses full implement pipeline)
    allStages.push(emptyStage(`implement-${issueNum}`));
    const implResult = await runImplement(cwd, String(issueNum), signal, onUpdate, ctx, { ...flags, autonomous: true });

    // Accumulate usage from detailed stages into the container stage
    const implStage = allStages.find((s) => s.name === `implement-${issueNum}`);
    if (implStage) {
      implStage.status = implResult.isError ? "failed" : "done";
      implStage.output = implResult.content[0]?.type === "text" ? implResult.content[0].text : "";
      const detailedStages = (implResult as AnyCtx).details?.stages as StageResult[] | undefined;
      if (detailedStages) implStage.usage = sumUsage(detailedStages);
    }

    if (implResult.isError) {
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed on issue #${issueNum}: ${implResult.content[0]?.type === "text" ? implResult.content[0].text : "unknown error"}`,
          },
        ],
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
          issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
          updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
          return {
            content: [{ type: "text" as const, text: `Failed to merge PR #${prNum} for issue #${issueNum}.` }],
            details: { pipeline: "implement-all", stages: allStages },
            isError: true,
          };
        }
      }
    } else {
      issueProgress.set(issueNum, { title: issueTitle, status: "failed" });
      updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
      return {
        content: [{ type: "text" as const, text: `No PR found for issue #${issueNum} after implementation.` }],
        details: { pipeline: "implement-all", stages: allStages },
        isError: true,
      };
    }

    // Mark done and update widget
    issueProgress.set(issueNum, { title: issueTitle, status: "done" });
    setForgeflowStatus(
      ctx,
      `implement-all · ${completed.size}/${completed.size + issues.length - 1} · $${sumUsage(allStages).cost.toFixed(2)}`,
    );
    updateProgressWidget(ctx, issueProgress, sumUsage(allStages).cost);
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
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  stages: StageResult[],
  diffCmd = "git diff main...HEAD",
  pipeline = "review",
  options: { prNumber?: string; interactive?: boolean } = {},
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const diff = await exec(diffCmd, cwd);

  if (!diff) {
    return { content: [{ type: "text", text: "No changes to review." }] };
  }

  const opts = { cwd, signal, stages, pipeline, onUpdate };

  // Clean up stale findings
  try {
    fs.unlinkSync(`${cwd}/FINDINGS.md`);
  } catch {}

  // Code reviewer
  stages.push(emptyStage("code-reviewer"));
  await runAgent("code-reviewer", `Review the following diff:\n\n${diff}`, { ...opts, tools: TOOLS_NO_EDIT });

  if (!fs.existsSync(`${cwd}/FINDINGS.md`)) {
    return { content: [{ type: "text", text: "Review passed — no actionable findings." }] };
  }

  // Review judge
  stages.push(emptyStage("review-judge"));
  const findings = fs.readFileSync(`${cwd}/FINDINGS.md`, "utf-8");
  await runAgent(
    "review-judge",
    `Validate the following code review findings against the actual code:\n\n${findings}`,
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  if (!fs.existsSync(`${cwd}/FINDINGS.md`)) {
    return { content: [{ type: "text", text: "Review passed — judge filtered all findings." }] };
  }

  const validatedFindings = fs.readFileSync(`${cwd}/FINDINGS.md`, "utf-8");

  // Interactive mode with PR: show findings and proposed gh commands for approval
  if (options.interactive && options.prNumber) {
    const repo = await exec("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
    const prNum = options.prNumber;

    const proposalPrompt = `You have validated code review findings for PR #${prNum} in ${repo}.

FINDINGS:
${validatedFindings}

Generate ready-to-run \`gh api\` commands to post each finding as a PR review comment. One command per finding.

Format each as:

**Finding N** — path/to/file.ts:LINE

\`\`\`bash
gh api repos/${repo}/pulls/${prNum}/comments \\
  --method POST \\
  --field body="<comment>" \\
  --field commit_id="$(gh pr view ${prNum} --repo ${repo} --json headRefOid -q .headRefOid)" \\
  --field path="path/to/file.ts" \\
  --field line=LINE \\
  --field side="RIGHT"
\`\`\`

Comment tone rules:
- Write like a teammate, not an auditor. Casual, brief, direct.
- 1-2 short sentences max. Lead with the suggestion, not the problem.
- Use "might be worth..." / "could we..." / "what about..." / "small thing:"
- No em dashes, no "Consider...", no "Note that...", no hedging filler.
- Use GitHub \`\`\`suggestion\`\`\` blocks when proposing code changes.
- Only generate commands for findings with a specific file + line.

After the comments, add the review decision command:

\`\`\`bash
gh pr review ${prNum} --request-changes --body "Left a few comments" --repo ${repo}
\`\`\`

Output ONLY the commands, no other text.`;

    stages.push(emptyStage("propose-comments"));
    await runAgent("review-judge", proposalPrompt, { cwd, signal, stages, pipeline, onUpdate, tools: TOOLS_READONLY });

    const commentStage = stages.find((s) => s.name === "propose-comments");
    const proposedCommands = commentStage?.output || "";

    if (proposedCommands && ctx.hasUI) {
      const reviewed = await ctx.ui.editor(
        `Review PR comments for PR #${prNum} (edit or close to skip)`,
        `${validatedFindings}\n\n---\n\nProposed commands (run these to post):\n\n${proposedCommands}`,
      );

      if (reviewed != null) {
        const action = await ctx.ui.select("Post these review comments?", ["Post comments", "Skip"]);
        if (action === "Post comments") {
          // Extract and run gh api commands
          const commands = reviewed.match(/```bash\n([\s\S]*?)```/g) || [];
          for (const block of commands) {
            const cmd = block
              .replace(/```bash\n/, "")
              .replace(/```$/, "")
              .trim();
            if (cmd.startsWith("gh ")) {
              await exec(cmd, cwd);
            }
          }
        }
      }
    }
  }

  return { content: [{ type: "text", text: validatedFindings }], isError: true };
}

async function runReview(cwd: string, target: string, signal: AbortSignal, onUpdate: AnyCtx, ctx: AnyCtx) {
  const stages: StageResult[] = [];

  let diffCmd = "git diff main...HEAD";
  let prNumber: string | undefined;

  if (target.match(/^\d+$/)) {
    diffCmd = `gh pr diff ${target}`;
    prNumber = target;
  } else if (target.startsWith("--branch")) {
    const branch = target.replace("--branch", "").trim() || "HEAD";
    diffCmd = `git diff main...${branch}`;
  } else {
    // Try to detect PR from current branch
    const pr = await exec("gh pr view --json number --jq .number 2>/dev/null", cwd);
    if (pr && pr !== "") prNumber = pr;
  }

  const result = await runReviewInline(cwd, signal, onUpdate, ctx, stages, diffCmd, "review", {
    prNumber,
    interactive: ctx.hasUI,
  });
  return { ...result, details: { pipeline: "review", stages } };
}
