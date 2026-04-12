import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { buildWidgetLines, renderResult as sharedRenderResult } from "../render/index.js";
import type { ForgeflowContext } from "../runtime/index.js";
import { type OnUpdate, type PipelineDetails, pipelineResult } from "../runtime/index.js";
import type { buildSchema } from "./schema.js";
import type { ExtensionConfig } from "./types.js";

// ─── pi.registerTool wiring + live widget plumbing ───────────────────

type ForgeflowToolSchema = ReturnType<typeof buildSchema>;

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
        }
        (onUpdate as OnUpdate | undefined)?.(partial);
      };

      try {
        if (!pipeline) {
          const names = config.pipelines.map((p) => p.name).join(", ");
          return pipelineResult(`Unknown pipeline: ${params.pipeline}. Use: ${names}`, params.pipeline as string, []);
        }
        return await pipeline.execute(cwd, params, sig, wrappedOnUpdate, fctx);
      } finally {
        if (fctx.hasUI) {
          fctx.ui.setStatus(config.toolName, undefined);
          fctx.ui.setWidget(config.toolName, undefined);
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
