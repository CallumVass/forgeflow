import {
  cleanSignal,
  emptyStage,
  type PipelineContext,
  readSignal,
  type StageResult,
  signalExists,
} from "@callumvass/forgeflow-shared/pipeline";
import { runChain } from "./chain.js";

/** Review pipeline result. */
interface ReviewResult {
  passed: boolean;
  findings?: string;
  /**
   * Session path of the review chain's tail phase (judge when it ran,
   * reviewer otherwise). Callers thread this as `initialForkFrom` on
   * a follow-up chain — typically `fix-findings` — so the fixer
   * inherits cold-eye reads and findings as conversation history
   * without inheriting the build chain's reasoning.
   */
  tailSessionPath?: string;
}

interface ReviewPipelineOptions extends PipelineContext {
  stages: StageResult[];
  pipeline?: string;
  customPrompt?: string;
}

/**
 * Run the code-reviewer → review-judge sub-chain against a diff.
 *
 * The reviewer starts cold: when called from `/implement` it sits on
 * the build-chain → review-chain boundary and `resetFork: true` forces
 * a fresh session even if the outer caller is still carrying a
 * `forkFrom`. When called from `/review` directly, it is already the
 * first phase in its own chain and cold-starts naturally.
 *
 * The judge forks from the reviewer within the review chain — it needs
 * the reviewer's reasoning as its input to validate findings, so
 * adversarial independence applies at the chain boundary, not inside
 * it.
 *
 * Returns `tailSessionPath` so callers can chain `fix-findings` off
 * the end of the review chain.
 */
export async function runReviewPipeline(diff: string, opts: ReviewPipelineOptions): Promise<ReviewResult> {
  const { cwd, stages, pipeline = "review", customPrompt } = opts;

  // Clean up stale findings so a prior run can't fool the signal check.
  cleanSignal(cwd, "findings");

  // Phase 1: code-reviewer. `resetFork` forces a fresh session at the
  // build→review boundary; `/review` callers (which have no prior chain)
  // are unaffected because forkFrom is already undefined for them.
  const reviewerChain = await runChain(
    [
      {
        agent: "code-reviewer",
        resetFork: true,
        buildTask: ({ customPrompt: cp }) => {
          const extra = cp ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${cp}` : "";
          return `Review the following diff:\n\n${diff}${extra}`;
        },
      },
    ],
    opts,
    { pipeline, stages, customPrompt },
  );

  if (!signalExists(cwd, "findings")) {
    return { passed: true, tailSessionPath: reviewerChain.lastSessionPath };
  }

  // Phase 2: review-judge, forked from the reviewer within the review
  // chain. It needs the reviewer's reasoning as its evaluation input.
  const findings = readSignal(cwd, "findings") ?? "";

  // Ensure a stage exists for the judge so runChain can reuse it (the
  // back-compat path in runChain looks up stages by name).
  if (!stages.some((s) => s.name === "review-judge")) stages.push(emptyStage("review-judge"));

  const judgeChain = await runChain(
    [
      {
        agent: "review-judge",
        buildTask: () => `Validate the following code review findings against the actual code:\n\n${findings}`,
      },
    ],
    opts,
    {
      pipeline,
      stages,
      // No customPrompt forwarded: the reviewer already had it, and
      // the judge forks from the reviewer so it inherits via history.
      initialForkFrom: reviewerChain.lastSessionPath,
    },
  );

  if (!signalExists(cwd, "findings")) {
    return { passed: true, tailSessionPath: judgeChain.lastSessionPath };
  }

  const validatedFindings = readSignal(cwd, "findings") ?? "";
  return { passed: false, findings: validatedFindings, tailSessionPath: judgeChain.lastSessionPath };
}
