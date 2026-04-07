import type { ForgeflowTheme } from "./context.js";
import { formatToolCall, getLastToolCalls } from "./display.js";
import type { StageResult } from "./stages.js";

// ─── Live widget content builder ──────────────────────────────────────

const MAX_TOOL_CALLS = 3;

/**
 * Build the lines for the live "current sub-agent" widget shown above
 * the editor while a forgeflow pipeline is running.
 *
 * The widget always renders something:
 * - When a stage is running, show its name + last 3 tool calls (or a
 *   `(starting…)` placeholder if it has not made any calls yet).
 * - When every stage is `done`, show a "complete" line.
 * - Otherwise (a brief gap between stages), show the next pending stage
 *   with the same `(starting…)` placeholder.
 *
 * The pipeline's `finally` block in `extension.ts` clears the widget
 * once execution ends, so this helper does not need an "empty" branch.
 */
export function buildWidgetLines(pipelineName: string, stages: StageResult[], theme: ForgeflowTheme): string[] {
  const total = stages.length;
  const completed = stages.filter((s) => s.status === "done").length;
  const header = theme.bold(theme.fg("toolTitle", pipelineName)) + theme.fg("muted", ` · ${completed}/${total} stages`);
  const lines: string[] = [header];

  const running = stages.find((s) => s.status === "running");
  if (running) {
    lines.push(`${theme.fg("accent", "⟳")} ${theme.bold(running.name)}`);
    const calls = getLastToolCalls(running.messages, MAX_TOOL_CALLS);
    if (calls.length === 0) {
      lines.push(`  ${theme.fg("muted", "(starting…)")}`);
    } else {
      for (const call of calls) {
        lines.push(`  ${formatToolCall(call.name, call.args, (c, t) => theme.fg(c, t))}`);
      }
    }
    return lines;
  }

  if (total > 0 && stages.every((s) => s.status === "done")) {
    lines.push(`${theme.fg("success", "✓")} ${theme.fg("muted", "complete")}`);
    return lines;
  }

  const pending = stages.find((s) => s.status === "pending");
  if (pending) {
    lines.push(`${theme.fg("muted", "○")} ${theme.bold(pending.name)} ${theme.fg("muted", "(starting…)")}`);
  }
  return lines;
}
