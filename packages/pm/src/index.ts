import { type AnyCtx, getFinalOutput, type PipelineDetails, type StageResult } from "@callumvass/forgeflow-shared";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { runContinue } from "./pipelines/continue.js";
import { runCreateIssue, runCreateIssues } from "./pipelines/create-issues.js";
import { runPrdQa } from "./pipelines/prd-qa.js";

// ─── Display helpers ──────────────────────────────────────────────────

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

interface ForgeflowPmInput {
  pipeline: string;
  maxIterations?: number;
  issue?: string;
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

const ForgeflowPmParams = Type.Object({
  pipeline: Type.String({
    description: 'Which pipeline to run: "continue", "prd-qa", "create-issues", or "create-issue"',
  }),
  maxIterations: Type.Optional(Type.Number({ description: "Max iterations for prd-qa (default 10)" })),
  issue: Type.Optional(Type.String({ description: "Feature idea for create-issue, or description for continue" })),
});

function registerForgeflowPmTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "forgeflow-pm",
    label: "Forgeflow PM",
    description: [
      "Run forgeflow PM pipelines: continue (update PRD Done/Next→QA→create issues for next phase),",
      "prd-qa (refine PRD), create-issues (decompose PRD into GitHub issues),",
      "create-issue (single issue from a feature idea).",
      "Each pipeline spawns specialized sub-agents with isolated context.",
    ].join(" "),
    parameters: ForgeflowPmParams as AnyCtx,

    async execute(
      _toolCallId: string,
      _params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: AnyCtx,
      ctx: AnyCtx,
    ) {
      const params = _params as ForgeflowPmInput;
      const cwd = ctx.cwd as string;
      const sig = signal ?? new AbortController().signal;

      try {
        switch (params.pipeline) {
          case "continue":
            return await runContinue(cwd, params.issue ?? "", params.maxIterations ?? 10, sig, onUpdate, ctx);
          case "prd-qa":
            return await runPrdQa(cwd, params.maxIterations ?? 10, sig, onUpdate, ctx);
          case "create-issues":
            return await runCreateIssues(cwd, sig, onUpdate, ctx);
          case "create-issue":
            return await runCreateIssue(cwd, params.issue ?? "", sig, onUpdate, ctx);
          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown pipeline: ${params.pipeline}. Use: continue, prd-qa, create-issues, create-issue`,
                },
              ],
              details: { pipeline: params.pipeline, stages: [] } as PipelineDetails,
            };
        }
      } finally {
        if (ctx.hasUI) {
          ctx.ui.setStatus("forgeflow-pm", undefined);
          ctx.ui.setWidget("forgeflow-pm", undefined);
        }
      }
    },

    renderCall(_args: unknown, theme: AnyCtx) {
      const args = _args as ForgeflowPmInput;
      const pipeline = args.pipeline || "?";
      let text = theme.fg("toolTitle", theme.bold("forgeflow-pm ")) + theme.fg("accent", pipeline);
      if (args.issue) text += theme.fg("dim", ` "${args.issue}"`);
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
    new Text(theme.fg("toolTitle", theme.bold("forgeflow-pm ")) + theme.fg("accent", details.pipeline), 0, 0),
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
  let text = theme.fg("toolTitle", theme.bold("forgeflow-pm ")) + theme.fg("accent", details.pipeline);
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

// ─── Extension entry point ────────────────────────────────────────────

const extension: (pi: ExtensionAPI) => void = (pi) => {
  registerForgeflowPmTool(pi);

  pi.registerCommand("continue", {
    description:
      'Update PRD with Done/Next based on codebase state, QA the Next section, then create issues. Usage: /continue ["description of next phase"]',
    handler: async (args) => {
      const trimmed = args.trim().replace(/^"(.*)"$/, "$1");
      const descPart = trimmed ? `, issue="${trimmed}"` : "";
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="continue"${descPart}. Do not interpret the description — pass it as-is.`,
      );
    },
  });

  pi.registerCommand("prd-qa", {
    description: "Refine PRD.md via critic → architect → integrator loop",
    handler: async (args) => {
      const maxIter = parseInt(args, 10) || 10;
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="prd-qa", maxIterations=${maxIter}.`,
      );
    },
  });

  pi.registerCommand("create-issues", {
    description: "Decompose PRD.md into vertical-slice GitHub issues",
    handler: async () => {
      pi.sendUserMessage(`Call the forgeflow-pm tool now with these exact parameters: pipeline="create-issues".`);
    },
  });

  pi.registerCommand("create-issue", {
    description: "Create a single GitHub issue from a feature idea",
    handler: async (args) => {
      if (!args.trim()) {
        pi.sendUserMessage('I need a feature idea. Usage: /create-issue "Add user authentication"');
        return;
      }
      pi.sendUserMessage(
        `Call the forgeflow-pm tool now with these exact parameters: pipeline="create-issue", issue="${args.trim()}". Do not interpret the issue text — pass it as-is.`,
      );
    },
  });
};

export default extension;
