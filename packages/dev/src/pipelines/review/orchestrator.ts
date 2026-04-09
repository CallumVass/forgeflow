import { emptyStage, type PipelineContext, type StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { runChain } from "../shared/index.js";

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

const NO_FINDINGS = "NO_FINDINGS";

function findingsFromStage(stages: StageResult[], stageName: string): string | undefined {
  const output = stages.find((stage) => stage.name === stageName)?.output?.trim();
  if (!output || output === NO_FINDINGS) return undefined;
  return output;
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
  const { stages, pipeline = "review", customPrompt } = opts;

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

  const findings = findingsFromStage(stages, "code-reviewer");
  if (!findings) {
    return { passed: true, tailSessionPath: reviewerChain.lastSessionPath };
  }

  // Phase 2: review-judge, forked from the reviewer within the review
  // chain. It needs the reviewer's reasoning as its evaluation input.

  // Ensure a stage exists for the judge so runChain can reuse it (the
  // back-compat path in runChain looks up stages by name).
  if (!stages.some((s) => s.name === "review-judge")) stages.push(emptyStage("review-judge"));

  const judgeChain = await runChain(
    [
      {
        agent: "review-judge",
        buildTask: () =>
          `Validate the following code review findings against the actual code:\n\n${findings}\n\nIf any findings survive validation, output ONLY the validated FINDINGS report. If no findings survive, output exactly ${NO_FINDINGS}.`,
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

  const validatedFindings = findingsFromStage(stages, "review-judge");
  if (!validatedFindings) {
    return { passed: true, tailSessionPath: judgeChain.lastSessionPath };
  }

  return { passed: false, findings: validatedFindings, tailSessionPath: judgeChain.lastSessionPath };
}
