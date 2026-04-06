import * as fs from "node:fs";
import { runAgent } from "@callumvass/forgeflow-shared/agent";
import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  TOOLS_NO_EDIT,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";

export async function runCreateIssue(idea: string, pctx: PipelineContext) {
  const { ctx } = pctx;
  // Ask for feature idea interactively if not provided
  if (!idea && ctx.hasUI) {
    const input = await ctx.ui.input("Feature idea?", "");
    idea = input?.trim() ?? "";
  }
  if (!idea) {
    return pipelineResult("No feature idea provided.", "create-issue", []);
  }

  const stages = [emptyStage("gh-single-issue-creator")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "create-issue" });

  await runAgent("gh-single-issue-creator", idea, { ...opts, tools: TOOLS_NO_EDIT });

  return pipelineResult("Issue created.", "create-issue", stages);
}

export async function runCreateIssues(pctx: PipelineContext) {
  if (!fs.existsSync(`${pctx.cwd}/PRD.md`)) {
    return pipelineResult("PRD.md not found.", "create-issues", []);
  }

  const stages = [emptyStage("gh-issue-creator")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "create-issues" });

  await runAgent(
    "gh-issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  return pipelineResult("Issue creation complete.", "create-issues", stages);
}
