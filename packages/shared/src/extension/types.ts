import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ForgeflowContext, ForgeflowTheme, OnUpdate, PipelineDetails } from "../pipeline.js";

// ─── Public type definitions for forgeflow extensions ────────────────

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
