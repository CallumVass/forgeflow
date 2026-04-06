import type { PipelineContext } from "@callumvass/forgeflow-shared/context";
import { exec } from "@callumvass/forgeflow-shared/exec";
import { pipelineResult, type StageResult } from "@callumvass/forgeflow-shared/stage";
import { askCustomPrompt } from "../utils/ui.js";
import { proposeAndPostComments } from "./review-comments.js";
import { resolveDiffTarget } from "./review-diff.js";
import { runReviewPipeline } from "./review-orchestrator.js";

export async function runReview(target: string, pctx: PipelineContext) {
  const { cwd, signal, onUpdate, ctx, agentsDir } = pctx;
  const stages: StageResult[] = [];
  const { diffCmd, prNumber } = await resolveDiffTarget(cwd, target);

  const customPrompt = await askCustomPrompt(ctx, ctx.hasUI);

  const diff = await exec(diffCmd, cwd);
  if (!diff) return pipelineResult("No changes to review.", "review", stages);

  const result = await runReviewPipeline(diff, {
    cwd,
    signal,
    stages,
    pipeline: "review",
    onUpdate,
    agentsDir,
    customPrompt,
  });
  if (result.passed) return pipelineResult("Review passed — no actionable findings.", "review", stages);

  const findings = result.findings ?? "";
  if (ctx.hasUI && prNumber) {
    const repo = await exec("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
    await proposeAndPostComments(findings, { number: prNumber, repo }, { ...pctx, stages, pipeline: "review" });
  }

  return pipelineResult(findings, "review", stages, true);
}
