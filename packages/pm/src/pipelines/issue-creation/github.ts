import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  toAgentOpts,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { missingPrdResult, prdExists } from "../../prd/index.js";

export async function runCreateIssue(idea: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "create-gh-issue", (innerPctx) => runCreateIssueInner(idea, innerPctx));
}

async function runCreateIssueInner(idea: string, pctx: PipelineContext) {
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

  await pctx.runAgentFn("gh-single-issue-creator", idea, opts);

  return pipelineResult("Issue created.", "create-issue", stages);
}

export async function runCreateIssues(pctx: PipelineContext) {
  return withRunLifecycle(pctx, "create-gh-issues", (innerPctx) => runCreateIssuesInner(innerPctx));
}

async function runCreateIssuesInner(pctx: PipelineContext) {
  if (!prdExists(pctx.cwd)) return missingPrdResult("create-issues");

  const stages = [emptyStage("gh-issue-creator")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "create-issues" });

  await pctx.runAgentFn(
    "gh-issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Treat the chosen options in ## Technical Direction as binding for issue guidance. Treat ## Alternatives Considered as explanatory context only. Read the issue-template skill for the standard format.",
    opts,
  );

  return pipelineResult("Issue creation complete.", "create-issues", stages);
}
