import type { ForgeflowTheme, StageResult } from "../runtime/index.js";
import { formatDuration, formatToolCall, formatUsage, getLastToolCalls } from "./display.js";
import { stageDescription, stageTitle } from "./stage-meta.js";

// ─── Live widget content builder ──────────────────────────────────────

const MAX_TOOL_CALLS = 3;

function runningForMs(stage: StageResult): number {
  if (!stage.startedAt) return 0;
  return (stage.completedAt ?? Date.now()) - stage.startedAt;
}

/**
 * Build the lines for the live "current sub-agent" widget shown above
 * the editor while a forgeflow pipeline is running.
 */
export function buildWidgetLines(pipelineName: string, stages: StageResult[], theme: ForgeflowTheme): string[] {
  const total = stages.length;
  const completed = stages.filter((s) => s.status === "done").length;
  const totalCost = stages.reduce((sum, stage) => sum + stage.usage.cost, 0);
  const stagesSuffix = total <= 1 ? "" : theme.fg("muted", ` · ${completed}/${total} stages`);
  const costSuffix = totalCost > 0 ? theme.fg("muted", ` · $${totalCost.toFixed(2)}`) : "";
  const header = theme.bold(theme.fg("toolTitle", pipelineName)) + stagesSuffix + costSuffix;
  const lines: string[] = [header];

  const running = stages.find((s) => s.status === "running");
  if (running) {
    const usage = formatUsage(running.usage, running.model);
    const usageSuffix = usage ? theme.fg("muted", ` · ${usage}`) : "";
    const elapsed = running.startedAt ? theme.fg("muted", ` · ${formatDuration(runningForMs(running))}`) : "";
    lines.push(`${theme.fg("accent", "⟳")} ${theme.bold(stageTitle(running.name))}${elapsed}${usageSuffix}`);
    const description = stageDescription(running.name);
    if (description) lines.push(`  ${theme.fg("muted", description)}`);
    const calls = getLastToolCalls(running.messages, MAX_TOOL_CALLS);
    if (calls.length === 0) {
      lines.push(`  ${theme.fg("muted", "(starting…)")}`);
    } else {
      for (const call of calls) {
        lines.push(`  ${formatToolCall(call.name, call.args, (c, t) => theme.fg(c, t))}`);
      }
    }
    const pending = stages.find((s) => s.status === "pending");
    if (pending) {
      lines.push(`  ${theme.fg("dim", `Next: ${stageTitle(pending.name)}`)}`);
    }
    return lines;
  }

  if (total > 0 && stages.every((s) => s.status === "done")) {
    lines.push(`${theme.fg("success", "✓")} ${theme.fg("muted", "complete")}`);
    return lines;
  }

  const pending = stages.find((s) => s.status === "pending");
  if (pending) {
    lines.push(`${theme.fg("muted", "○")} ${theme.bold(stageTitle(pending.name))} ${theme.fg("muted", "(starting…)")}`);
    const description = stageDescription(pending.name);
    if (description) lines.push(`  ${theme.fg("muted", description)}`);
  }
  return lines;
}
