import {
  type AgentConfig,
  DEFAULT_SESSIONS,
  DEFAULT_SKILLS,
  loadForgeflowConfig,
  type SessionsConfig,
  type SkillsConfig,
} from "../../config/forgeflow-config.js";
import type { RunDirHandle } from "../../session/run-dir/index.js";
import type { SelectedSkill } from "../../skills/index.js";
import { runAgent } from "../run-agent.js";
import type { OnUpdate } from "../stages.js";
import type { PipelineAgentRuntime } from "./agent.js";
import { defaultExecRuntime, type PipelineExecRuntime } from "./exec.js";
import type { PipelineSessionRuntime } from "./session.js";
import type { PipelineSkillRuntime } from "./skills.js";
import type { ForgeflowContext, PipelineUiRuntime } from "./ui.js";

export interface PipelineContext
  extends PipelineAgentRuntime,
    PipelineExecRuntime,
    PipelineUiRuntime,
    PipelineSkillRuntime,
    PipelineSessionRuntime {}

export type PipelineContextOverrides = Partial<
  Pick<
    PipelineContext,
    "runAgentFn" | "execFn" | "execSafeFn" | "agentOverrides" | "skillsConfig" | "selectedSkills" | "sessionsConfig"
  >
>;

export function toPipelineContext(
  cwd: string,
  signal: AbortSignal,
  onUpdate: OnUpdate,
  ctx: ForgeflowContext,
  agentsDir: string,
  overrides?: PipelineContextOverrides,
): PipelineContext {
  const loaded = loadForgeflowConfig(cwd, (msg) => ctx.ui.notify(msg, "warning"));
  const agentOverrides = overrides?.agentOverrides ?? loaded.agents ?? {};
  const skillsConfig = overrides?.skillsConfig ?? loaded.skills ?? DEFAULT_SKILLS;
  const sessionsConfig = overrides?.sessionsConfig ?? loaded.sessions ?? DEFAULT_SESSIONS;

  return {
    cwd,
    signal,
    onUpdate: onUpdate as OnUpdate | undefined,
    ctx,
    agentsDir,
    runAgentFn: overrides?.runAgentFn ?? runAgent,
    execFn: overrides?.execFn ?? defaultExecRuntime.execFn,
    execSafeFn: overrides?.execSafeFn ?? defaultExecRuntime.execSafeFn,
    agentOverrides,
    skillsConfig,
    selectedSkills: overrides?.selectedSkills ?? [],
    sessionsConfig,
  };
}

export type { AgentConfig, RunDirHandle, SelectedSkill, SessionsConfig, SkillsConfig };
