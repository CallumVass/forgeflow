import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { prepareSkillContext } from "@callumvass/forgeflow-shared/skills";
import { askCustomPrompt } from "../../ui/index.js";
import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { runReviewPipeline, runStandaloneReviewPipeline } from "./orchestrator.js";

export { runReviewPipeline };

interface RunReviewOptions {
  strict?: boolean;
}

function parseChangedFiles(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function prepareReviewSkillContext(changedFiles: string[], strict: boolean, pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: strict ? "review-lite" : "review", changedFiles });
}

type ReviewTarget = Awaited<ReturnType<typeof resolveDiffTarget>>;

async function resolveChangedFilesForTarget(target: ReviewTarget, pctx: PipelineContext): Promise<string[]> {
  for (const cmd of target.setupCmds) {
    await pctx.execFn(cmd, pctx.cwd);
  }

  const output =
    (await pctx.execSafeFn("git diff --name-only main...HEAD", pctx.cwd)) ||
    (target.diffCmd.includes("gh pr diff")
      ? await pctx.execSafeFn("git diff --name-only HEAD~1...HEAD", pctx.cwd)
      : "");
  return parseChangedFiles(output);
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

export async function resolveReviewChangedFiles(target: string, pctx: PipelineContext): Promise<string[]> {
  const reviewTarget = await resolveDiffTarget(pctx.cwd, target, pctx.execSafeFn);
  return resolveChangedFilesForTarget(reviewTarget, pctx);
}

async function runReviewInner(target: string, pctx: PipelineContext, strict: boolean) {
  const { cwd, ctx, execFn, execSafeFn } = pctx;
  const stages: StageResult[] = [];
  const reviewTarget = await resolveDiffTarget(cwd, target, execSafeFn);
  const { diffCmd, prNumber } = reviewTarget;

  const changedFiles = await resolveChangedFilesForTarget(reviewTarget, pctx);
  const skillPrepared = await prepareReviewSkillContext(changedFiles, strict, pctx);
  pctx = skillPrepared.pctx;

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
