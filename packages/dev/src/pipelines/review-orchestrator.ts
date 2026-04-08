import {
  cleanSignal,
  emptyStage,
  type PipelineContext,
  readSignal,
  type StageResult,
  signalExists,
  TOOLS_NO_EDIT,
} from "@callumvass/forgeflow-shared/pipeline";

interface ReviewResult {
  passed: boolean;
  findings?: string;
}

interface ReviewPipelineOptions extends PipelineContext {
  stages: StageResult[];
  pipeline?: string;
  customPrompt?: string;
}

/**
 * Run the code-reviewer → review-judge pipeline.
 * Takes a diff string, returns validated findings or a "passed" result.
 * No UI interaction, no PR posting.
 */
export async function runReviewPipeline(diff: string, opts: ReviewPipelineOptions): Promise<ReviewResult> {
  const { cwd, signal, stages, pipeline = "review", onUpdate, customPrompt, agentsDir, runAgentFn } = opts;

  const agentOpts = { agentsDir, cwd, signal, stages, pipeline, onUpdate };
  const extraInstructions = customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}` : "";

  // Clean up stale findings
  cleanSignal(cwd, "findings");

  // Code reviewer
  stages.push(emptyStage("code-reviewer"));
  await runAgentFn("code-reviewer", `Review the following diff:\n\n${diff}${extraInstructions}`, {
    ...agentOpts,
    tools: TOOLS_NO_EDIT,
  });

  if (!signalExists(cwd, "findings")) {
    return { passed: true };
  }

  // Review judge
  stages.push(emptyStage("review-judge"));
  const findings = readSignal(cwd, "findings") ?? "";
  await runAgentFn(
    "review-judge",
    `Validate the following code review findings against the actual code:\n\n${findings}`,
    { ...agentOpts, tools: TOOLS_NO_EDIT },
  );

  if (!signalExists(cwd, "findings")) {
    return { passed: true };
  }

  const validatedFindings = readSignal(cwd, "findings") ?? "";
  return { passed: false, findings: validatedFindings };
}
