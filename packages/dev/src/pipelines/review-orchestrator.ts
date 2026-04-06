import { TOOLS_NO_EDIT } from "@callumvass/forgeflow-shared/constants";
import { resolveRunAgent } from "@callumvass/forgeflow-shared/di";
import { cleanSignal, readSignal, signalExists } from "@callumvass/forgeflow-shared/signals";
import { emptyStage, type RunAgentFn, type RunAgentOpts } from "@callumvass/forgeflow-shared/stage";

interface ReviewResult {
  passed: boolean;
  findings?: string;
}

/**
 * Run the code-reviewer → review-judge pipeline.
 * Takes a diff string, returns validated findings or a "passed" result.
 * No UI interaction, no PR posting.
 */
export async function runReviewPipeline(
  diff: string,
  opts: Pick<RunAgentOpts, "cwd" | "signal" | "stages" | "pipeline" | "onUpdate" | "agentsDir"> & {
    customPrompt?: string;
    runAgentFn?: RunAgentFn;
  },
): Promise<ReviewResult> {
  const { cwd, signal, stages, pipeline = "review", onUpdate, customPrompt, agentsDir } = opts;

  const runAgentFn = await resolveRunAgent(opts.runAgentFn);

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
