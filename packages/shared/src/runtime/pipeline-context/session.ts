import type { SessionsConfig } from "../../config/forgeflow-config.js";
import type { RunDirHandle } from "../../session/run-dir/index.js";
import type { PipelineAgentRuntime } from "./agent.js";
import type { ForgeflowContext } from "./ui.js";

export type { ArchiveOutcome, RunDirHandle } from "../../session/run-dir/index.js";

export interface PipelineSessionRuntime {
  cwd: string;
  ctx: ForgeflowContext;
  sessionsConfig: SessionsConfig;
  runDir?: RunDirHandle;
}

export type PipelineSessionLifecycleRuntime = PipelineSessionRuntime & Pick<PipelineAgentRuntime, "runAgentFn">;
