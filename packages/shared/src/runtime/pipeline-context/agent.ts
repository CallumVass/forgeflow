import type { AgentConfig } from "../../config/forgeflow-config.js";
import type { SelectedSkill } from "../../skills/index.js";
import type { OnUpdate, RunAgentFn, RunAgentOpts, StageResult } from "../stages.js";

export interface PipelineAgentRuntime {
  cwd: string;
  signal: AbortSignal;
  onUpdate: OnUpdate | undefined;
  agentsDir: string;
  runAgentFn: RunAgentFn;
  agentOverrides: Record<string, AgentConfig>;
  selectedSkills: SelectedSkill[];
}

export function toAgentOpts(
  runtime: PipelineAgentRuntime,
  extra: { stages: StageResult[]; pipeline: string },
): RunAgentOpts {
  return {
    cwd: runtime.cwd,
    signal: runtime.signal,
    onUpdate: runtime.onUpdate,
    agentsDir: runtime.agentsDir,
    agentOverrides: runtime.agentOverrides,
    selectedSkills: runtime.selectedSkills,
    ...extra,
  };
}
