import type { PipelineContext, StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { buildRefactorReviewTask } from "../../refactor-guidance/index.js";
import { runChain } from "../shared/index.js";
import { NO_FINDINGS } from "./constants.js";

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

interface StandaloneReviewResult {
  hasBlockingFindings: boolean;
  blockingFindings?: string;
  architectureFindings?: string;
  refactorFindings?: string;
  report?: string;
}

interface ReviewPipelineOptions extends PipelineContext {
  stages: StageResult[];
  pipeline?: string;
  customPrompt?: string;
}

function findingsFromStage(stages: StageResult[], stageName: string): string | undefined {
  const output = stages.find((stage) => stage.name === stageName)?.output?.trim();
  if (!output || output === NO_FINDINGS) return undefined;
  return output;
}

function withCustomPrompt(task: string, customPrompt?: string): string {
  if (!customPrompt) return task;
  return `${task}\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}`;
}

function buildArchitectureDeltaTask(diff: string, customPrompt?: string): string {
  return withCustomPrompt(
    `Review the following diff for architectural or boundary regressions introduced or worsened by this change:\n\n${diff}\n\nFocus ONLY on files touched by the diff and their immediate neighbours. This is not a full repo audit and not RFC mode.\n\nLook for:\n- cross-feature internal imports where a public entry point exists\n- flat-root sprawl or junk-drawer growth introduced by the change\n- duplicated abstractions created beside an existing boundary\n- touched files turning into obvious god modules or leaky abstractions\n- business logic, infrastructure, and UI concerns mixed more tightly than before\n\nOnly report concerns introduced or clearly worsened by this diff. Ignore pre-existing repo issues unless this change makes them materially worse.\n\nIf you find concerns, output a markdown report headed exactly \`## Architecture delta review\`, then present numbered candidates ranked by severity using the normal candidate format. If nothing rises above that bar, output exactly ${NO_FINDINGS}.`,
    customPrompt,
  );
}

function buildStandaloneReviewReport(sections: {
  blockingFindings?: string;
  architectureFindings?: string;
  refactorFindings?: string;
}): string | undefined {
  const parts = [sections.blockingFindings, sections.architectureFindings, sections.refactorFindings].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
}

async function runAdvisoryReview(
  agent: string,
  stageName: string,
  task: string,
  opts: ReviewPipelineOptions,
): Promise<string | undefined> {
  const { stages, pipeline = "review", customPrompt } = opts;

  await runChain(
    [
      {
        agent,
        stageName,
        buildTask: ({ customPrompt: cp }) => withCustomPrompt(task, cp),
      },
    ],
    opts,
    { pipeline, stages, customPrompt },
  );

  return findingsFromStage(stages, stageName);
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

  const reviewerChain = await runChain(
    [
      {
        agent: "code-reviewer",
        resetFork: true,
        buildTask: ({ customPrompt: cp }) => withCustomPrompt(`Review the following diff:\n\n${diff}`, cp),
      },
    ],
    opts,
    { pipeline, stages, customPrompt },
  );

  const findings = findingsFromStage(stages, "code-reviewer");
  if (!findings) {
    return { passed: true, tailSessionPath: reviewerChain.lastSessionPath };
  }

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
      initialForkFrom: reviewerChain.lastSessionPath,
    },
  );

  const validatedFindings = findingsFromStage(stages, "review-judge");
  if (!validatedFindings) {
    return { passed: true, tailSessionPath: judgeChain.lastSessionPath };
  }

  return { passed: false, findings: validatedFindings, tailSessionPath: judgeChain.lastSessionPath };
}

/**
 * Run standalone `/review`: strict blocking review first, then advisory
 * architecture/refactor passes for human review.
 */
export async function runStandaloneReviewPipeline(
  diff: string,
  opts: ReviewPipelineOptions,
): Promise<StandaloneReviewResult> {
  const blocking = await runReviewPipeline(diff, opts);
  const blockingFindings = blocking.passed ? undefined : blocking.findings;

  const architectureFindings = await runAdvisoryReview(
    "architecture-reviewer",
    "architecture-delta-reviewer",
    buildArchitectureDeltaTask(diff),
    opts,
  );

  const refactorFindings = await runAdvisoryReview(
    "refactor-reviewer",
    "refactor-reviewer",
    buildRefactorReviewTask(diff),
    opts,
  );

  const report = buildStandaloneReviewReport({
    blockingFindings,
    architectureFindings,
    refactorFindings,
  });

  return {
    hasBlockingFindings: Boolean(blockingFindings),
    blockingFindings,
    architectureFindings,
    refactorFindings,
    report,
  };
}
