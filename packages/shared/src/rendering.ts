import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { ForgeflowTheme, PipelineDetails, StageResult } from "./pipeline.js";

// ─── Message parser (merged from message-parser.ts) ───────────────────

/** Parse a single NDJSON line into a structured event. Returns null for unparseable lines. */
export function parseMessageLine(line: string): { type: string; message?: Message } | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as { type: string; message?: Message };
  } catch {
    return null;
  }
}

/** Apply a parsed message event to a stage, accumulating usage stats. Returns true if stage was updated. */
export function applyMessageToStage(event: { type?: string; message?: Message }, stage: StageResult): boolean {
  if (event.type === "message_end" && event.message) {
    const msg = event.message;
    stage.messages.push(msg);
    if (msg.role === "assistant") {
      stage.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        stage.usage.input += usage.input || 0;
        stage.usage.output += usage.output || 0;
        stage.usage.cacheRead += usage.cacheRead || 0;
        stage.usage.cacheWrite += usage.cacheWrite || 0;
        stage.usage.cost += usage.cost?.total || 0;
      }
      if (!stage.model && msg.model) stage.model = msg.model;
    }
    return true;
  }
  if (event.type === "tool_result_end" && event.message) {
    stage.messages.push(event.message);
    return true;
  }
  return false;
}

/** Walk assistant messages backwards to extract the last text block. */
export function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const msg = messages[i]!;
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
          return part.text as string;
        }
      }
    }
  }
  return "";
}

/** Extract final text output from a stage's messages. */
export function extractFinalOutput(stage: StageResult): void {
  stage.output = getFinalOutput(stage.messages);
}

// ─── Display helpers ──────────────────────────────────────────────────

export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

export function getDisplayItems(messages: Message[]): DisplayItem[] {
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

type Colorise = (colour: string, text: string) => string;
const plain: Colorise = (_colour, text) => text;

export function formatToolCall(name: string, args: Record<string, unknown>, fg: Colorise = plain): string {
  switch (name) {
    case "bash": {
      const cmd = ((args.command as string) || "").slice(0, 60);
      const ellipsis = ((args.command as string) || "").length > 60 ? "..." : "";
      const display = cmd || "...";
      return fg("muted", "$ ") + fg("toolOutput", display + ellipsis);
    }
    case "read":
    case "write":
    case "edit":
      return fg("muted", `${name} `) + fg("accent", (args.file_path || args.path || "...") as string);
    case "grep":
      return fg("muted", "grep ") + fg("accent", `/${args.pattern || ""}/`);
    case "find":
      return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string);
    default:
      return fg("accent", name);
  }
}

/** @deprecated Use `formatToolCall` instead. */
export function formatToolCallShort(
  name: string,
  args: Record<string, unknown>,
  fg: (c: string, t: string) => string,
): string {
  return formatToolCall(name, args, fg);
}

export function formatUsage(
  usage: { input: number; output: number; cost: number; turns: number },
  model?: string,
): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns}t`);
  if (usage.input) parts.push(`↑${usage.input < 1000 ? usage.input : `${Math.round(usage.input / 1000)}k`}`);
  if (usage.output) parts.push(`↓${usage.output < 1000 ? usage.output : `${Math.round(usage.output / 1000)}k`}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

export function stageIcon(stage: StageResult, theme: ForgeflowTheme): string {
  return stage.status === "done"
    ? theme.fg("success", "✓")
    : stage.status === "running"
      ? theme.fg("warning", "⟳")
      : stage.status === "failed"
        ? theme.fg("error", "✗")
        : theme.fg("muted", "○");
}

export function renderExpanded(details: PipelineDetails, theme: ForgeflowTheme, toolLabel: string) {
  const container = new Container();
  container.addChild(
    new Text(theme.fg("toolTitle", theme.bold(`${toolLabel} `)) + theme.fg("accent", details.pipeline), 0, 0),
  );
  container.addChild(new Spacer(1));

  for (const stage of details.stages) {
    const icon = stageIcon(stage, theme);
    container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(stage.name))}`, 0, 0));

    const items = getDisplayItems(stage.messages);
    for (const item of items) {
      if (item.type === "toolCall") {
        container.addChild(
          new Text(`  ${theme.fg("muted", "→ ")}${formatToolCall(item.name, item.args, theme.fg.bind(theme))}`, 0, 0),
        );
      }
    }

    const output = getFinalOutput(stage.messages);
    if (output) {
      container.addChild(new Spacer(1));
      container.addChild(new Markdown(output.trim(), 0, 0, getMarkdownTheme()));
    }

    const usageStr = formatUsage(stage.usage, stage.model);
    if (usageStr) container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
    container.addChild(new Spacer(1));
  }

  return container;
}

export function renderResult(
  result: AgentToolResult<PipelineDetails>,
  expanded: boolean,
  theme: ForgeflowTheme,
  toolLabel: string,
) {
  const details = result.details as PipelineDetails | undefined;
  if (!details || details.stages.length === 0) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }
  return expanded ? renderExpanded(details, theme, toolLabel) : renderCollapsed(details, theme, toolLabel);
}

export function renderCollapsed(details: PipelineDetails, theme: ForgeflowTheme, toolLabel: string) {
  let text = theme.fg("toolTitle", theme.bold(`${toolLabel} `)) + theme.fg("accent", details.pipeline);
  for (const stage of details.stages) {
    const icon = stageIcon(stage, theme);
    text += `\n  ${icon} ${theme.fg("toolTitle", stage.name)}`;

    if (stage.status === "running") {
      const items = getDisplayItems(stage.messages);
      const last = items.filter((i) => i.type === "toolCall").slice(-3);
      for (const item of last) {
        if (item.type === "toolCall") {
          text += `\n    ${theme.fg("muted", "→ ")}${formatToolCall(item.name, item.args, theme.fg.bind(theme))}`;
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
