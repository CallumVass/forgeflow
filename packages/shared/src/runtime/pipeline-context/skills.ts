import type { SkillsConfig } from "../../config/forgeflow-config.js";
import type { SelectedSkill } from "../../skills/index.js";
import type { PipelineExecRuntime } from "./exec.js";

export interface PipelineSkillRuntime {
  cwd: string;
  skillsConfig: SkillsConfig;
}

export interface PipelineSkillSelectionRuntime extends PipelineSkillRuntime {
  selectedSkills: SelectedSkill[];
}

export type PipelineSkillRecommendationRuntime = PipelineSkillRuntime & Pick<PipelineExecRuntime, "execSafeFn">;
