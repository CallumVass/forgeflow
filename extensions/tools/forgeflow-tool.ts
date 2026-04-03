import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { runArchitecture } from "./pipelines/architecture.js";
import { runCreateIssue, runCreateIssues } from "./pipelines/create-issues.js";
import { runImplement } from "./pipelines/implement.js";
import { runImplementAll } from "./pipelines/implement-all.js";
import { runPrdQa } from "./pipelines/prd-qa.js";
import { runReview } from "./pipelines/review.js";
import { type AnyCtx, getFinalOutput, type PipelineDetails, type StageResult } from "./types.js";
import { setForgeflowStatus, setForgeflowWidget } from "./utils/ui.js";

// ─── Display helpers ──────────────────────────────────────────────────

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

// ─── Tool registration ────────────────────────────────────────────────

const ForgeflowParams = Type.Object({
  pipeline: Type.String({
    description:
      'Which pipeline to run: "prd-qa", "create-issues", "create-issue", "implement", "implement-all", "review", or "architecture"',
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
      "implement-all (loop through all open issues autonomously), review (deterministic checks→code review→judge),",
      "architecture (analyze codebase for structural friction→create RFC issues).",
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
          case "architecture":
            return await runArchitecture(cwd, sig, onUpdate, ctx);
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
        return renderExpanded(details, theme);
      }
      return renderCollapsed(details, theme);
    },
  });
}

// ─── Rendering ────────────────────────────────────────────────────────

function renderExpanded(details: PipelineDetails, theme: AnyCtx) {
  const container = new Container();
  container.addChild(
    new Text(theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", details.pipeline), 0, 0),
  );
  container.addChild(new Spacer(1));

  for (const stage of details.stages) {
    const icon = stageIcon(stage, theme);
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

function renderCollapsed(details: PipelineDetails, theme: AnyCtx) {
  let text = theme.fg("toolTitle", theme.bold("forgeflow ")) + theme.fg("accent", details.pipeline);
  for (const stage of details.stages) {
    const icon = stageIcon(stage, theme);
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
}

function stageIcon(stage: StageResult, theme: AnyCtx): string {
  return stage.status === "done"
    ? theme.fg("success", "✓")
    : stage.status === "running"
      ? theme.fg("warning", "⟳")
      : stage.status === "failed"
        ? theme.fg("error", "✗")
        : theme.fg("muted", "○");
}
