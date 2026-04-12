import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  type OnUpdate,
  type PipelineContext,
  type PipelineDetails,
  resolveAgentsDir,
  toPipelineContext,
} from "../runtime/index.js";
import { registerAtlassianCommands } from "./atlassian.js";
import { registerForgeflowCommands } from "./commands.js";
import { buildSchema } from "./schema.js";
import { registerForgeflowTool } from "./tool.js";
import type { CommandDefinition, ExtensionConfig, ParamDef } from "./types.js";

export interface PackagePipelineDefinition {
  name: string;
  run: (params: Record<string, unknown>, pctx: PipelineContext) => Promise<AgentToolResult<PipelineDetails>>;
}

export interface PackageExtensionConfig extends Omit<ExtensionConfig, "pipelines"> {
  moduleUrl: string;
  pipelines: PackagePipelineDefinition[];
  registerExtraCommands?: (pi: ExtensionAPI) => void;
  onSessionStart?: (
    ctx: Parameters<ExtensionAPI["on"]>[1] extends (event: unknown, ctx: infer T) => unknown ? T : never,
  ) => Promise<void> | void;
}

function adaptPipelines(moduleUrl: string, pipelines: PackagePipelineDefinition[]): ExtensionConfig["pipelines"] {
  const agentsDir = resolveAgentsDir(moduleUrl);
  return pipelines.map((pipeline) => ({
    name: pipeline.name,
    execute: (cwd: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: OnUpdate, ctx) =>
      pipeline.run(params, toPipelineContext(cwd, signal, onUpdate, ctx, agentsDir)),
  }));
}

function toExtensionConfig(config: PackageExtensionConfig): ExtensionConfig {
  return {
    toolName: config.toolName,
    toolLabel: config.toolLabel,
    description: config.description,
    params: config.params as Record<string, ParamDef>,
    pipelines: adaptPipelines(config.moduleUrl, config.pipelines),
    commands: config.commands as CommandDefinition[],
    renderCallExtra: config.renderCallExtra,
    onCommandInvoked: config.onCommandInvoked,
    onResult: config.onResult,
  };
}

export function createForgeflowPackageExtension(config: PackageExtensionConfig): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    const extensionConfig = toExtensionConfig(config);
    registerForgeflowTool(pi, extensionConfig, buildSchema(extensionConfig));
    registerForgeflowCommands(pi, extensionConfig);
    registerAtlassianCommands(pi, { toolName: config.toolName });
    config.registerExtraCommands?.(pi);
    if (config.onSessionStart) {
      pi.on("session_start", async (_event, ctx) => {
        await config.onSessionStart?.(ctx as never);
      });
    }
  };
}
