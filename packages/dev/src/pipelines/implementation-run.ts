import {
  cleanSignal,
  type PipelineContext,
  readSignal,
  type StageResult,
  signalExists,
} from "@callumvass/forgeflow-shared/pipeline";
import type { ResolvedIssue } from "../utils/issue-tracker.js";
import { type Phase, runChain } from "./chain.js";
import { buildImplementorPrompt } from "./implement-phases.js";
import { runPlanning } from "./planning.js";
import { runReviewPipeline } from "./review-orchestrator.js";

/**
 * Thin wrapper around the review chain for callers that only need review
 * (e.g. resume-with-existing-PR). Lets `implement.ts` avoid a direct
 * import of `review-orchestrator.js` per the structural criteria.
 */
export async function runReviewAndFixOnly(pctx: PipelineContext, stages: StageResult[]): Promise<void> {
  const diff = await pctx.execFn("git diff main...HEAD", pctx.cwd);
  if (!diff) return;
  const result = await runReviewPipeline(diff, { ...pctx, stages, pipeline: "implement" });
  if (result.passed) return;
  await runFixFindings(pctx, stages, result.findings ?? "", result.tailSessionPath);
}

/**
 * Thin wrapper for resume-with-commits: run the refactorer then the
 * review chain. No planning, no implementor. Refactorer cold-starts
 * because no prior phase produced a session.
 */
export async function runRefactorAndReview(
  pctx: PipelineContext,
  stages: StageResult[],
  skipReview: boolean,
): Promise<void> {
  await runChain(
    [
      {
        agent: "refactorer",
        buildTask: () =>
          "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit and push if changed.",
      },
    ],
    pctx,
    { pipeline: "implement", stages },
  );
  if (!skipReview) await runReviewAndFixOnly(pctx, stages);
}

/**
 * Spawn the implementor in `fix-findings` mode to address validated
 * review findings. `forkFrom` is the session path of the review chain's
 * tail (judge when it ran, reviewer otherwise) so the fixer inherits
 * cold-eye reads and the findings themselves as conversation history.
 */
async function runFixFindings(
  pctx: PipelineContext,
  stages: StageResult[],
  findings: string,
  reviewChainTail: string | undefined,
): Promise<void> {
  await runChain(
    [
      {
        agent: "implementor",
        stageName: "fix-findings",
        buildTask: () =>
          `Fix the following code review findings:\n\n${findings}\n\nRULES:\n- Fix only the cited issues. Do not refactor or improve unrelated code.\n- Run the check command after fixes.\n- Commit and push the fixes.`,
      },
    ],
    pctx,
    { pipeline: "implement", stages, initialForkFrom: reviewChainTail },
  );
  cleanSignal(pctx.cwd, "findings");
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
 * Run the build chain (planner → architecture-reviewer → implementor →
 * refactorer) followed by the review chain (code-reviewer → review-judge
 * → fix-findings). Chains share context via `pi --fork`; the review
 * chain starts cold (`resetFork: true`) to preserve adversarial
 * independence from the build chain's reasoning.
 *
 * Dynamic fix-findings handling lives here rather than in `runChain`:
 * after the review chain returns, check FINDINGS.md and, if present,
 * kick off a single-phase follow-up chain forking from the review
 * chain's tail.
 */
export async function runImplementation(input: RunInput, pctx: PipelineContext): Promise<RunOutcome> {
  const { issueContext, resolved, customPrompt, flags } = input;
  const interactive = pctx.ctx.hasUI && !flags.autonomous;

  const stages: StageResult[] = [];

  // --- Planning (handles its own session paths; may interactively edit) ---
  let plan = "";
  let planSessionPath: string | undefined;
  if (!flags.skipPlan) {
    const planResult = await runPlanning(issueContext, customPrompt, {
      ...pctx,
      interactive,
      stages,
    });
    if (planResult.failed) {
      const stageLabel = planResult.errorStage === "architecture-reviewer" ? "Architecture reviewer" : "Planner";
      return { kind: "failed", stages, error: `${stageLabel} failed: ${planResult.plan}` };
    }
    if (planResult.cancelled) {
      return { kind: "cancelled", stages, reason: "Implementation cancelled." };
    }
    plan = planResult.plan;
    planSessionPath = planResult.lastSessionPath;
  }

  // --- Build chain: implementor → refactorer ---
  // The implementor forks from the planning sub-chain's tail, inheriting
  // the planner's reads + the architecture critique as real conversation
  // history. The refactorer then forks from the implementor.
  //
  // Split into two `runChain` calls so the blocked signal check fires
  // BEFORE the refactorer runs — the old behaviour that callers rely on
  // (an implementor that writes BLOCKED.md halts the pipeline).
  cleanSignal(pctx.cwd, "blocked");

  const implementorPhase: Phase = {
    agent: "implementor",
    buildTask: ({ isFirstInChain, customPrompt: cp }) =>
      buildImplementorPrompt({
        issueContext,
        plan,
        customPrompt: cp,
        resolved,
        autonomous: flags.autonomous,
        isColdStart: isFirstInChain && !planSessionPath,
      }),
  };

  const implementorResult = await runChain([implementorPhase], pctx, {
    pipeline: "implement",
    stages,
    customPrompt,
    plan,
    initialForkFrom: planSessionPath,
  });

  const implementorStage = stages.find((s) => s.name === "implementor");
  if (implementorStage?.status === "failed") {
    const detail = implementorStage.output || implementorStage.stderr || "Implementor exited with no output.";
    return { kind: "failed", stages, error: `Implementor failed: ${detail}` };
  }

  if (signalExists(pctx.cwd, "blocked")) {
    const reason = readSignal(pctx.cwd, "blocked") ?? "";
    return { kind: "blocked", stages, reason };
  }

  const refactorerPhase: Phase = {
    agent: "refactorer",
    buildTask: () =>
      "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit and push if changed.",
  };

  await runChain([refactorerPhase], pctx, {
    pipeline: "implement",
    stages,
    // customPrompt NOT passed: the implementor already saw it; the
    // refactorer forks from the implementor and inherits it via history.
    plan,
    initialForkFrom: implementorResult.lastSessionPath,
  });

  const refactorerStage = stages.find((s) => s.name === "refactorer");
  if (refactorerStage?.status === "failed") {
    const detail = refactorerStage.output || refactorerStage.stderr || "Refactorer exited with no output.";
    return { kind: "failed", stages, error: `Refactorer failed: ${detail}` };
  }

  // --- Review chain: reviewer → judge ---
  // resetFork on the reviewer preserves adversarial independence: the
  // reviewer reads the diff cold, with no inherited reasoning from the
  // build chain. The judge forks from the reviewer within the review
  // chain to inherit cold-eye reads + the reviewer's analysis.
  if (flags.skipReview) {
    return { kind: "completed", stages };
  }

  const diff = await pctx.execFn("git diff main...HEAD", pctx.cwd);
  if (!diff) return { kind: "completed", stages };

  // runReviewPipeline now handles the reviewer → judge fork link
  // internally and cold-starts the reviewer (its own chain boundary).
  const reviewResult = await runReviewPipeline(diff, {
    ...pctx,
    stages,
    pipeline: "implement",
    customPrompt,
  });

  if (!reviewResult.passed) {
    await runFixFindings(pctx, stages, reviewResult.findings ?? "", reviewResult.tailSessionPath);
  }

  return { kind: "completed", stages };
}
