import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { askCustomPrompt } from "../../ui/index.js";
import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { runReviewPipeline } from "./orchestrator.js";

export { runReviewPipeline };

function reviewRunId(target: string): string {
  const trimmed = target.trim();
  return trimmed ? `review-${trimmed}` : "review";
}

export async function runReview(target: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, reviewRunId(target), (innerPctx) => runReviewInner(target, innerPctx));
}

async function runReviewInner(target: string, pctx: PipelineContext) {
  const { cwd, ctx, execFn, execSafeFn } = pctx;
  const stages: StageResult[] = [];
  const { diffCmd, prNumber, setupCmds } = await resolveDiffTarget(cwd, target, execSafeFn);

  for (const cmd of setupCmds) {
    await execFn(cmd, cwd);
  }

  const customPrompt = await askCustomPrompt(ctx, ctx.hasUI);

  const diff = await execFn(diffCmd, cwd);
  if (!diff) return pipelineResult("No changes to review.", "review", stages);

  const result = await runReviewPipeline(diff, { ...pctx, stages, pipeline: "review", customPrompt });
  if (result.passed) return pipelineResult("Review passed — no actionable findings.", "review", stages);

  const findings = result.findings ?? "";
  if (ctx.hasUI && prNumber) {
    const repo = await execFn("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
    await proposeAndPostComments(findings, { number: prNumber, repo }, { ...pctx, stages, pipeline: "review" });
  }

  return pipelineResult(findings, "review", stages, true);
}
