import { exec, type ForgeflowContext, type OnUpdate, type StageResult } from "@callumvass/forgeflow-shared";
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

export async function runReview(
  cwd: string,
  target: string,
  signal: AbortSignal,
  onUpdate: OnUpdate | undefined,
  ctx: ForgeflowContext,
  customPrompt?: string,
) {
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
    await proposeAndPostComments(
      findings,
      { number: prNumber, repo },
      { cwd, signal, stages, ctx, pipeline: "review", onUpdate },
    );
  }

  return reviewResult(findings, stages, true);
}
