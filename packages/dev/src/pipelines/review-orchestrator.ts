import {
  cleanSignal,
  emptyStage,
  type OnUpdate,
  readSignal,
  type StageResult,
  signalExists,
  TOOLS_NO_EDIT,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";
import { resolveRunAgent, type RunAgentFn } from "./run-agent-di.js";

export interface ReviewResult {
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
  opts: {
    cwd: string;
    signal: AbortSignal;
    stages: StageResult[];
    pipeline?: string;
    onUpdate?: OnUpdate;
    customPrompt?: string;
    runAgentFn?: RunAgentFn;
  },
): Promise<ReviewResult> {
  const { cwd, signal, stages, pipeline = "review", onUpdate, customPrompt } = opts;

  const runAgentFn = await resolveRunAgent(opts.runAgentFn);

  const agentOpts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline, onUpdate };
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
