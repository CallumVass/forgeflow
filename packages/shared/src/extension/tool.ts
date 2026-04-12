import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  buildWidgetLines,
  formatDuration,
  openStagesOverlay,
  renderResult as sharedRenderResult,
  stageTitle,
} from "../render/index.js";
import type { ForgeflowContext } from "../runtime/index.js";
import { type OnUpdate, type PipelineDetails, pipelineResult } from "../runtime/index.js";
import type { buildSchema } from "./schema.js";
import type { ExtensionConfig } from "./types.js";

// ─── pi.registerTool wiring + live widget plumbing ───────────────────

type ForgeflowToolSchema = ReturnType<typeof buildSchema>;

const seenStagesHints = new Set<string>();

function buildSessionName(toolName: string, params: Record<string, unknown>): string {
  const pipeline = typeof params.pipeline === "string" ? params.pipeline : "run";
  const issue = typeof params.issue === "string" ? params.issue : undefined;
  const target = typeof params.target === "string" ? params.target : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt : undefined;
  const suffix = issue ?? target ?? prompt;
  return suffix ? `${toolName} ${pipeline} ${suffix}` : `${toolName} ${pipeline}`;
}

function buildStatusText(toolName: string, details: PipelineDetails): string {
  const running = details.stages.find((stage) => stage.status === "running");
  if (!running) return `${toolName} ${details.pipeline}`;

  const elapsed = running.startedAt
    ? ` · ${formatDuration((running.completedAt ?? Date.now()) - running.startedAt)}`
    : "";
  const cost = running.usage.cost > 0 ? ` · $${running.usage.cost.toFixed(2)}` : "";
  return `${toolName} ${details.pipeline} · ${stageTitle(running.name)}${elapsed}${cost}`;
}

function installFooter(ctx: ForgeflowContext, toolName: string, details: PipelineDetails): void {
  if (!ctx.ui.setFooter) return;
  ctx.ui.setFooter((_tui, theme, footerData) => ({
    invalidate() {},
    render(width: number): string[] {
      const branch = footerData.getGitBranch?.() ?? null;
      const left = theme.fg("dim", buildStatusText(toolName, details));
      const branchText = branch ? theme.fg("muted", branch) : theme.fg("muted", "no-git");
      const line = `${left} ${theme.fg("dim", "·")} ${branchText}`;
      return [line.slice(0, width)];
    },
  }));
}

/**
 * Register the forgeflow tool on the supplied `pi.ExtensionAPI`. Wires the
 * tool's `execute` to dispatch to the correct pipeline by name, repaints the
 * live widget on every progress frame when a UI is attached, and clears the
 * status + widget in `finally` so the editor returns to its idle state on
 * both success and failure.
 */
export function registerForgeflowTool(pi: ExtensionAPI, config: ExtensionConfig, schema: ForgeflowToolSchema): void {
  const pipelineMap = new Map(config.pipelines.map((p) => [p.name, p]));

  pi.registerTool({
    name: config.toolName,
    label: config.toolLabel,
    description: config.description,
    parameters: schema,

    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const params = _params as Record<string, unknown>;
      const pipeline = pipelineMap.get(params.pipeline as string);
      const cwd = ctx.cwd as string;
      const sig = signal ?? new AbortController().signal;
      const fctx = ctx as unknown as ForgeflowContext;
      pi.setSessionName(buildSessionName(config.toolName, params));

      // Wrap the user-supplied onUpdate so that every progress update from a
      // sub-agent also repaints the live widget above the editor with the
      // current stage and last few tool calls. Stays a no-op when there is
      // no UI (e.g. `pi -p` print mode).
      const wrappedOnUpdate: OnUpdate = (partial) => {
        if (fctx.hasUI && partial.details) {
          const lines = buildWidgetLines(
            `${config.toolName} ${partial.details.pipeline}`,
            partial.details.stages,
            fctx.ui.theme,
          );
          fctx.ui.setWidget(config.toolName, lines);
          fctx.ui.setStatus(config.toolName, buildStatusText(config.toolName, partial.details));
          installFooter(fctx, config.toolName, partial.details);
          if (!seenStagesHints.has(config.toolName)) {
            seenStagesHints.add(config.toolName);
            fctx.ui.notify("Tip: use /stages or Ctrl+Shift+S to inspect pipeline stages.", "info");
          }
        }
        (onUpdate as OnUpdate | undefined)?.(partial);
      };

      try {
        if (!pipeline) {
          const names = config.pipelines.map((p) => p.name).join(", ");
          return pipelineResult(`Unknown pipeline: ${params.pipeline}. Use: ${names}`, params.pipeline as string, []);
        }
        const result = await pipeline.execute(cwd, params, sig, wrappedOnUpdate, fctx);
        if (config.onResult && fctx.hasUI) {
          await config.onResult(params, result as AgentToolResult<PipelineDetails> & { isError?: boolean }, fctx, {
            exec: (command, args = [], options) => pi.exec(command, args, options),
            openStages: async (details) => {
              await openStagesOverlay(fctx, [config.toolName], details);
            },
            queueFollowUp: (text) => {
              pi.sendUserMessage(text, { deliverAs: "followUp" });
            },
            notify: (message, level) => {
              fctx.ui.notify(message, level);
            },
          });
        }
        return result;
      } finally {
        if (fctx.hasUI) {
          fctx.ui.setStatus(config.toolName, undefined);
          fctx.ui.setWidget(config.toolName, undefined);
          fctx.ui.setFooter?.(undefined);
        }
      }
    },

    renderCall(_args, theme) {
      const args = _args as Record<string, unknown>;
      const pipeline = (args.pipeline as string) || "?";
      let text = theme.fg("toolTitle", theme.bold(`${config.toolName} `)) + theme.fg("accent", pipeline);
      if (config.renderCallExtra) {
        text += config.renderCallExtra(args, theme);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      return sharedRenderResult(result as AgentToolResult<PipelineDetails>, expanded, theme, config.toolName);
    },
  });
}
