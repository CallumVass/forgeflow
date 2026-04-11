import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import { prepareSkillContext } from "@callumvass/forgeflow-shared/skills";

export async function prepareInitSkillContext(pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "init" });
}

export async function prepareContinueSkillContext(description: string, pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "continue", issueText: description });
}

export async function prepareInvestigateSkillContext(description: string, pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "investigate", issueText: description });
}

export async function prepareCreateIssueSkillContext(idea: string, pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "create-gh-issue", issueText: idea });
}

export async function prepareCreateIssuesSkillContext(pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: "create-gh-issues" });
}
