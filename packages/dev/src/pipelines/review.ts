import { exec } from "@callumvass/forgeflow-shared/exec";
import type { PipelineContext, StageResult } from "@callumvass/forgeflow-shared/types";
import { proposeAndPostComments } from "./review-comments.js";
import { resolveDiffTarget } from "./review-diff.js";
import { runReviewPipeline } from "./review-orchestrator.js";

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  details: { pipeline: string; stages: StageResult[] };
};
const reviewResult = (text: string, stages: StageResult[], isError?: boolean): TextResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError } : {}),
  details: { pipeline: "review", stages },
});

export async function runReview(target: string, pctx: PipelineContext, customPrompt?: string) {
  const { cwd, signal, onUpdate, ctx } = pctx;
  const stages: StageResult[] = [];
  const { diffCmd, prNumber } = await resolveDiffTarget(cwd, target);

  if (ctx.hasUI && !customPrompt) {
    const extra = await ctx.ui.input("Additional instructions?", "Skip");
    if (extra?.trim()) customPrompt = extra.trim();
  }

  const diff = await exec(diffCmd, cwd);
  if (!diff) return reviewResult("No changes to review.", stages);

  const result = await runReviewPipeline(diff, { cwd, signal, stages, pipeline: "review", onUpdate, customPrompt });
  if (result.passed) return reviewResult("Review passed — no actionable findings.", stages);

  const findings = result.findings ?? "";
  if (ctx.hasUI && prNumber) {
    const repo = await exec("gh repo view --json nameWithOwner --jq .nameWithOwner", cwd);
    await proposeAndPostComments(findings, { number: prNumber, repo }, { ...pctx, stages, pipeline: "review" });
  }

  return reviewResult(findings, stages, true);
}
