import {
  type PipelineContext,
  type PipelineExecRuntime,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import {
  readRepositoryNameWithOwner,
  readReviewDiff,
  resolveReviewChangedFiles as resolveRepositoryReviewChangedFiles,
} from "@callumvass/forgeflow-shared/repository";
import { prepareSkillContext } from "@callumvass/forgeflow-shared/skills";
import { askCustomPrompt, setForgeflowStatus } from "../../ui/index.js";
import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { runReviewPipeline, runStandaloneReviewPipeline } from "./orchestrator.js";

export { runReviewPipeline };

interface RunReviewOptions {
  strict?: boolean;
}

function describeReviewTarget(target: string, prNumber?: string): string {
  const trimmed = target.trim();
  if (prNumber) return `PR #${prNumber}`;
  if (!trimmed) return "current branch";
  if (trimmed.startsWith("--branch")) return trimmed.replace("--branch", "branch").trim();
  return trimmed;
}

async function prepareReviewSkillContext(changedFiles: string[], strict: boolean, pctx: PipelineContext) {
  return prepareSkillContext(pctx, { command: strict ? "review-lite" : "review", changedFiles });
}

type ReviewTarget = Awaited<ReturnType<typeof resolveDiffTarget>>;

function reviewTargetPrNumber(target: ReviewTarget): string | undefined {
  return target.kind === "branch" ? undefined : target.prNumber;
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

export async function resolveReviewChangedFiles(target: string, pctx: PipelineExecRuntime): Promise<string[]> {
  const reviewTarget = await resolveDiffTarget(pctx.cwd, target, pctx.execSafeFn);
  return resolveRepositoryReviewChangedFiles(reviewTarget, pctx);
}

async function runReviewInner(target: string, pctx: PipelineContext, strict: boolean) {
  const { cwd, ctx, execFn, execSafeFn } = pctx;
  const stages: StageResult[] = [];
  const reviewTarget = await resolveDiffTarget(cwd, target, execSafeFn);
  const prNumber = reviewTargetPrNumber(reviewTarget);

  const changedFiles = await resolveRepositoryReviewChangedFiles(reviewTarget, pctx);
  if (ctx.hasUI) {
    const fileSummary =
      changedFiles.length > 0 ? ` · ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}` : "";
    setForgeflowStatus(
      ctx,
      `review · ${describeReviewTarget(target, prNumber)}${strict ? " · strict" : ""}${fileSummary}`,
    );
  }

  const skillPrepared = await prepareReviewSkillContext(changedFiles, strict, pctx);
  pctx = skillPrepared.pctx;

  const customPrompt = await askCustomPrompt(ctx, ctx.hasUI);

  const diff = await readReviewDiff(reviewTarget, { cwd, execFn });
  if (!diff) {
    return pipelineResult(
      `No changes to review for ${describeReviewTarget(target, prNumber)} against main.`,
      "review",
      stages,
    );
  }

  if (strict) {
    const result = await runReviewPipeline(diff, { ...pctx, stages, pipeline: "review", customPrompt });
    if (result.passed) return pipelineResult("Review passed — no actionable findings.", "review", stages);

    const findings = result.findings ?? "";
    if (ctx.hasUI && prNumber) {
      const repo = await readRepositoryNameWithOwner({ cwd, execFn });
      await proposeAndPostComments(findings, { number: prNumber, repo }, { ...pctx, stages, pipeline: "review" });
    }

    return pipelineResult(findings, "review", stages, true);
  }

  const result = await runStandaloneReviewPipeline(diff, { ...pctx, stages, pipeline: "review", customPrompt });
  if (!result.report) return pipelineResult("Review passed — no actionable findings.", "review", stages);

  if (ctx.hasUI && prNumber && result.blockingFindings) {
    const repo = await readRepositoryNameWithOwner({ cwd, execFn });
    await proposeAndPostComments(
      result.blockingFindings,
      { number: prNumber, repo },
      { ...pctx, stages, pipeline: "review" },
    );
  }

  return pipelineResult(result.report, "review", stages, result.hasBlockingFindings);
}
