import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { renderResult as sharedRenderResult } from "./rendering.js";
import {
  type ForgeflowContext,
  type ForgeflowTheme,
  type OnUpdate,
  type PipelineDetails,
  pipelineResult,
} from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface ParamDef {
  type: "string" | "number" | "boolean";
  description: string;
}

export interface PipelineDefinition {
  name: string;
  execute: (
    cwd: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: OnUpdate,
    ctx: ForgeflowContext,
  ) => Promise<AgentToolResult<PipelineDetails>>;
}

export interface CommandDefinition {
  name: string;
  description: string;
  /** Which pipeline this command invokes */
  pipeline: string;
  /** Parse raw args into params and optional suffix for the sendUserMessage template */
  parseArgs?: (args: string) => { params?: Record<string, string | number | boolean | undefined>; suffix?: string };
}

export interface ExtensionConfig {
  toolName: string;
  toolLabel: string;
  description: string;
  /** All tool parameters (excluding `pipeline` which is auto-added) */
  params: Record<string, ParamDef>;
  pipelines: PipelineDefinition[];
  commands: CommandDefinition[];
  /** Optional hook to append custom content to renderCall output */
  renderCallExtra?: (args: Record<string, unknown>, theme: ForgeflowTheme) => string;
}

// ─── Message builder ──────────────────────────────────────────────────

/** Build the sendUserMessage template string for a command invocation. */
export function buildSendMessage(
  toolName: string,
  pipeline: string,
  params: Record<string, string | number | boolean | undefined>,
  suffix?: string,
): string {
  let msg = `Call the ${toolName} tool now with these exact parameters: pipeline="${pipeline}"`;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      msg += `, ${key}="${value}"`;
    } else {
      msg += `, ${key}=${value}`;
    }
  }
  msg += ".";
  if (suffix) msg += ` ${suffix}`;
  return msg;
}

// ─── Schema builder ───────────────────────────────────────────────────

function buildTypeBoxParam(def: ParamDef) {
  switch (def.type) {
    case "string":
      return Type.String({ description: def.description });
    case "number":
      return Type.Number({ description: def.description });
    case "boolean":
      return Type.Boolean({ description: def.description });
  }
}

function buildSchema(config: ExtensionConfig) {
  const pipelineNames = config.pipelines.map((p) => p.name);
  const pipelineDesc = `Which pipeline to run: ${pipelineNames.map((n) => `"${n}"`).join(", ")}`;

  const props: Record<string, unknown> = {
    pipeline: Type.String({ description: pipelineDesc }),
  };

  for (const [key, def] of Object.entries(config.params)) {
    props[key] = Type.Optional(buildTypeBoxParam(def));
  }

  return Type.Object(props as Record<string, ReturnType<typeof Type.String>>);
}

// ─── Factory ──────────────────────────────────────────────────────────

/** Create a forgeflow extension from a declarative config. */
export function createForgeflowExtension(config: ExtensionConfig): (pi: ExtensionAPI) => void {
  const schema = buildSchema(config);
  const pipelineMap = new Map(config.pipelines.map((p) => [p.name, p]));

  return (pi: ExtensionAPI) => {
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

        try {
          if (!pipeline) {
            const names = config.pipelines.map((p) => p.name).join(", ");
            return pipelineResult(`Unknown pipeline: ${params.pipeline}. Use: ${names}`, params.pipeline as string, []);
          }
          return await pipeline.execute(cwd, params, sig, onUpdate as OnUpdate, ctx as unknown as ForgeflowContext);
        } finally {
          if (ctx.hasUI) {
            ctx.ui.setStatus(config.toolName, undefined);
            ctx.ui.setWidget(config.toolName, undefined);
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

    for (const cmd of config.commands) {
      pi.registerCommand(cmd.name, {
        description: cmd.description,
        handler: async (args) => {
          if (cmd.parseArgs) {
            const { params, suffix } = cmd.parseArgs(args);
            pi.sendUserMessage(buildSendMessage(config.toolName, cmd.pipeline, params ?? {}, suffix));
          } else {
            pi.sendUserMessage(buildSendMessage(config.toolName, cmd.pipeline, {}));
          }
        },
      });
    }
  };
}
