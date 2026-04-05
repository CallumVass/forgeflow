import * as fs from "node:fs";
import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { TOOLS_NO_EDIT } from "@callumvass/forgeflow-shared/constants";
import { emptyStage, type PipelineContext, toAgentOpts } from "@callumvass/forgeflow-shared/types";
import { AGENTS_DIR } from "../resolve.js";

export async function runCreateIssue(idea: string, pctx: PipelineContext) {
  const { ctx } = pctx;
  // Ask for feature idea interactively if not provided
  if (!idea && ctx.hasUI) {
    const input = await ctx.ui.input("Feature idea?", "");
    idea = input?.trim() ?? "";
  }
  if (!idea) {
    return {
      content: [{ type: "text" as const, text: "No feature idea provided." }],
      details: { pipeline: "create-issue", stages: [] },
    };
  }

  const stages = [emptyStage("gh-single-issue-creator")];
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline: "create-issue" });

  await runAgent("gh-single-issue-creator", idea, { ...opts, tools: TOOLS_NO_EDIT });

  return {
    content: [{ type: "text" as const, text: "Issue created." }],
    details: { pipeline: "create-issue", stages },
  };
}

export async function runCreateIssues(pctx: PipelineContext) {
  if (!fs.existsSync(`${pctx.cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "create-issues", stages: [] },
    };
  }

  const stages = [emptyStage("gh-issue-creator")];
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline: "create-issues" });

  await runAgent(
    "gh-issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Read the issue-template skill for the standard format.",
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  return {
    content: [{ type: "text" as const, text: "Issue creation complete." }],
    details: { pipeline: "create-issues", stages },
  };
}
