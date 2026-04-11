import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { askCustomPrompt } from "../../ui/index.js";
import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { runReviewPipeline, runStandaloneReviewPipeline } from "./orchestrator.js";

export { runReviewPipeline };

interface RunReviewOptions {
  strict?: boolean;
}

function reviewRunId(target: string, strict: boolean): string {
  const trimmed = target.trim();
  if (!trimmed) return strict ? "review-lite" : "review";
  return strict ? `review-lite-${trimmed}` : `review-${trimmed}`;
}

export async function runReview(target: string, pctx: PipelineContext, opts: RunReviewOptions = {}) {
  const strict = opts.strict ?? false;
  return withRunLifecycle(pctx, reviewRunId(target, strict), (innerPctx) => runReviewInner(target, innerPctx, strict));
}

async function runReviewInner(target: string, pctx: PipelineContext, strict: boolean) {
  const { cwd, ctx, execFn, execSafeFn } = pctx;
  const stages: StageResult[] = [];
  const { diffCmd, prNumber, setupCmds } = await resolveDiffTarget(cwd, target, execSafeFn);

  for (const cmd of setupCmds) {
    await execFn(cmd, cwd);
  }

  const customPrompt = await askCustomPrompt(ctx, ctx.hasUI);

  const diff = await execFn(diffCmd, cwd);
  if (!diff) return pipelineResult("No changes to review.", "review", stages);

  if (strict) {
    const result = await runReviewPipeline(diff, { ...pctx, stages, pipeline: "review", customPrompt });
    if (result.passed) return pipelineResult("Review passed — no actionable findings.", "review", stages);

    const findings = result.findings ?? "";
    if (ctx.hasUI && prNumber) {
      const repo = await execFn("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
      await proposeAndPostComments(findings, { number: prNumber, repo }, { ...pctx, stages, pipeline: "review" });
    }

    return pipelineResult(findings, "review", stages, true);
  }

  const result = await runStandaloneReviewPipeline(diff, { ...pctx, stages, pipeline: "review", customPrompt });
  if (!result.report) return pipelineResult("Review passed — no actionable findings.", "review", stages);

  if (ctx.hasUI && prNumber && result.blockingFindings) {
    const repo = await execFn("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
    await proposeAndPostComments(
      result.blockingFindings,
      { number: prNumber, repo },
      { ...pctx, stages, pipeline: "review" },
    );
  }

  return pipelineResult(result.report, "review", stages, result.hasBlockingFindings);
}
