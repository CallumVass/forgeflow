import type { PipelineSkillSelectionRuntime } from "@callumvass/forgeflow-shared/pipeline";
import { prepareSkillContext } from "@callumvass/forgeflow-shared/skills";

export async function prepareInitSkillContext<T extends PipelineSkillSelectionRuntime>(pctx: T) {
  return prepareSkillContext(pctx, { command: "init" });
}

export async function prepareContinueSkillContext<T extends PipelineSkillSelectionRuntime>(
  description: string,
  pctx: T,
) {
  return prepareSkillContext(pctx, { command: "continue", issueText: description });
}

export async function prepareInvestigateSkillContext<T extends PipelineSkillSelectionRuntime>(
  description: string,
  pctx: T,
) {
  return prepareSkillContext(pctx, { command: "investigate", issueText: description });
}

export async function prepareCreateIssueSkillContext<T extends PipelineSkillSelectionRuntime>(idea: string, pctx: T) {
  return prepareSkillContext(pctx, { command: "create-gh-issue", issueText: idea });
}

export async function prepareCreateIssuesSkillContext<T extends PipelineSkillSelectionRuntime>(pctx: T) {
  return prepareSkillContext(pctx, { command: "create-gh-issues" });
}
