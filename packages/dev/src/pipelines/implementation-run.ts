import { emptyStage, type PipelineContext, type StageResult, toAgentOpts } from "@callumvass/forgeflow-shared/pipeline";
import type { ResolvedIssue } from "../utils/git.js";
import {
  buildImplementorPrompt,
  type PhaseContext,
  refactorAndReview,
  reviewAndFix,
  runImplementorPhase,
} from "./implement-phases.js";
import { runPlanning } from "./planning.js";

function buildPhaseContext(pctx: PipelineContext, stages: StageResult[]): PhaseContext {
  return { ...pctx, agentOpts: toAgentOpts(pctx, { stages, pipeline: "implement" }), stages };
}

/**
 * Thin wrapper around `reviewAndFix` for callers that only need the review
 * phase (e.g. resume-with-existing-PR). Lets `implement.ts` avoid a direct
 * import of `implement-phases.js` per the structural criteria.
 */
export async function runReviewAndFixOnly(pctx: PipelineContext, stages: StageResult[]): Promise<void> {
  await reviewAndFix(buildPhaseContext(pctx, stages));
}

/**
 * Thin wrapper around `refactorAndReview` for callers that only need the
 * refactor + review phases (e.g. resume-with-commits).
 */
export async function runRefactorAndReview(
  pctx: PipelineContext,
  stages: StageResult[],
  skipReview: boolean,
): Promise<void> {
  await refactorAndReview(buildPhaseContext(pctx, stages), skipReview);
}

export interface RunInput {
  issueContext: string;
  resolved: ResolvedIssue;
  customPrompt?: string;
  flags: { skipPlan: boolean; skipReview: boolean; autonomous: boolean };
}

export type RunOutcome =
  | { kind: "completed"; stages: StageResult[] }
  | { kind: "cancelled"; stages: StageResult[]; reason: string }
  | { kind: "blocked"; stages: StageResult[]; reason: string }
  | { kind: "failed"; stages: StageResult[]; error: string };

/**
 * Run the planner → implementor → refactor → review sequence for a fresh
 * implementation of an issue. Owns the `stages` array and the per-phase
 * `PhaseContext` closure that `runImplement` used to construct three separate
 * times. One place to add a new phase; one place that reads
 * `flags.autonomous` via `buildImplementorPrompt`.
 */
export async function runImplementation(input: RunInput, pctx: PipelineContext): Promise<RunOutcome> {
  const { issueContext, resolved, customPrompt, flags } = input;
  const interactive = pctx.ctx.hasUI && !flags.autonomous;

  const stages: StageResult[] = [];
  if (!flags.skipPlan) stages.push(emptyStage("planner"), emptyStage("architecture-reviewer"));
  stages.push(emptyStage("implementor"), emptyStage("refactorer"));

  // --- Planning ---
  let plan = "";
  if (!flags.skipPlan) {
    const planResult = await runPlanning(issueContext, customPrompt, {
      ...pctx,
      interactive,
      stages,
    });
    if (planResult.failed) {
      return { kind: "failed", stages, error: `Planner failed: ${planResult.plan}` };
    }
    if (planResult.cancelled) {
      return { kind: "cancelled", stages, reason: "Implementation cancelled." };
    }
    plan = planResult.plan;
  }

  // --- Implementor ---
  const prompt = buildImplementorPrompt(issueContext, plan, customPrompt, resolved, flags.autonomous);
  const blocked = await runImplementorPhase(buildPhaseContext(pctx, stages), prompt);
  if (blocked != null) {
    return { kind: "blocked", stages, reason: blocked };
  }

  // --- Refactor + Review ---
  await refactorAndReview(buildPhaseContext(pctx, stages), flags.skipReview);

  return { kind: "completed", stages };
}
