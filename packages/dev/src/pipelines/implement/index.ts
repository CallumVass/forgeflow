import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { askCustomPrompt, setForgeflowStatus } from "../../ui/index.js";
import { type IssuePlan, resolveIssuePlan } from "./issue-resolution.js";
import { finalisePr } from "./pr-lifecycle.js";
import { type RunInput, type RunOutcome, runImplementation, runRefactorAndReview, runReviewAndFixOnly } from "./run.js";

interface ImplementFlags {
  skipPlan: boolean;
  skipReview: boolean;
  autonomous?: boolean;
}

const DEFAULT_FLAGS: ImplementFlags = { skipPlan: false, skipReview: false };

/**
 * Derive a run id for `.forgeflow/run/<runId>/` from the user-supplied
 * issue argument. Falls back to "implement" when the argument is empty
 * so the directory is never created with an empty or `-` name. Sanitising
 * and length-capping are handled downstream in `createRunDir`.
 */
function implementRunId(issueArg: string): string {
  const trimmed = issueArg.trim();
  if (!trimmed) return "implement";
  return `implement-${trimmed}`;
}

export async function runImplement(issueArg: string, pctx: PipelineContext, flags: ImplementFlags = DEFAULT_FLAGS) {
  return withRunLifecycle(pctx, implementRunId(issueArg), (innerPctx) => runImplementInner(issueArg, innerPctx, flags));
}

async function runImplementInner(issueArg: string, pctx: PipelineContext, flags: ImplementFlags = DEFAULT_FLAGS) {
  const plan = await resolveIssuePlan(issueArg, pctx);
  if ("error" in plan) return pipelineResult(plan.error, "implement", []);

  const { resolved, issueLabel, issueContext, resume } = plan;
  const autonomous = flags.autonomous ?? false;
  const interactive = pctx.ctx.hasUI && !autonomous;

  if (!autonomous && (resolved.number || resolved.key)) {
    const isGH = resolved.source === "github" && resolved.number > 0;
    setForgeflowStatus(
      pctx.ctx,
      `${isGH ? `#${resolved.number}` : resolved.key} ${resolved.title} · ${resolved.branch}`,
    );
  }

  const customPrompt = await askCustomPrompt(pctx.ctx, interactive);

  if (resume.kind === "existing-pr") return resumeExistingPr(issueLabel, resume.prNumber, pctx, flags);
  if (resume.kind === "resume-branch") return resumeBranch(plan, pctx, flags);
  if (resume.kind === "failed") return pipelineResult(resume.error, "implement", [], true);

  const input: RunInput = { issueContext, resolved, customPrompt, flags: { ...flags, autonomous } };
  const outcome: RunOutcome = await runImplementation(input, pctx);
  if (outcome.kind === "failed") return pipelineResult(outcome.error, "implement", outcome.stages, true);
  if (outcome.kind === "blocked")
    return pipelineResult(`Implementor blocked:\n${outcome.reason}`, "implement", outcome.stages, true);
  if (outcome.kind === "cancelled") return pipelineResult(outcome.reason, "implement", outcome.stages);

  const { prNumber } = await finalisePr(resolved, pctx, { autonomous: true, stages: outcome.stages });

  return pipelineResult(
    prNumber > 0
      ? `Implementation of ${issueLabel} complete — PR #${prNumber} is ready for review.`
      : `Implementation of ${issueLabel} complete.`,
    "implement",
    outcome.stages,
  );
}

async function resumeExistingPr(issueLabel: string, prNumber: number, pctx: PipelineContext, flags: ImplementFlags) {
  const stages: StageResult[] = [];
  if (!flags.skipReview) await runReviewAndFixOnly(pctx, stages);
  return pipelineResult(`Resumed ${issueLabel} — PR #${prNumber} already exists.`, "implement", stages);
}

async function resumeBranch(plan: IssuePlan, pctx: PipelineContext, flags: ImplementFlags) {
  const stages: StageResult[] = [];
  // Push existing commits and create a PR, but do NOT merge — the user will
  // manually merge after reviewing the resumed work.
  await finalisePr(plan.resolved, pctx, { autonomous: true, stages });
  await runRefactorAndReview(pctx, stages, flags.skipReview);
  return pipelineResult(`Resumed ${plan.issueLabel} — pushed existing commits and created PR.`, "implement", stages);
}
