import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { ForgeflowTheme } from "./context.js";
import { formatToolCall, formatUsage, getDisplayItems } from "./display.js";
import { getFinalOutput } from "./message-parser.js";
import type { PipelineDetails, StageResult } from "./stages.js";

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
