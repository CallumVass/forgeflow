import {
  cleanSignal,
  emptyStage,
  type PipelineContext,
  type RunAgentOpts,
  readSignal,
  type StageResult,
  signalExists,
} from "@callumvass/forgeflow-shared/pipeline";
import type { ResolvedIssue } from "../utils/issue-tracker.js";
import { runReviewPipeline } from "./review-orchestrator.js";

/**
 * Per-phase context: a `PipelineContext` (carrying the `runAgentFn` /
 * `execFn` seams) plus the live `agentOpts` and `stages` for the current
 * implementation phase.
 */
export interface PhaseContext extends PipelineContext {
  agentOpts: RunAgentOpts;
  stages: StageResult[];
}

/** Run code review on the branch diff and auto-fix findings if any. */
export async function reviewAndFix(pctx: PhaseContext, pipeline = "implement"): Promise<void> {
  const diff = await pctx.execFn("git diff main...HEAD", pctx.cwd);
  if (!diff) return;
  const reviewResult = await runReviewPipeline(diff, { ...pctx, stages: pctx.stages, pipeline });
  if (!reviewResult.passed) {
    const findings = reviewResult.findings ?? "";
    pctx.stages.push(emptyStage("fix-findings"));
    await pctx.runAgentFn(
      "implementor",
      `Fix the following code review findings:\n\n${findings}\n\nRULES:\n- Fix only the cited issues. Do not refactor or improve unrelated code.\n- Run the check command after fixes.\n- Commit and push the fixes.`,
      { ...pctx.agentOpts, pipeline, stageName: "fix-findings" },
    );
    cleanSignal(pctx.cwd, "findings");
  }
}

/** Run refactorer agent, then optionally review. */
export async function refactorAndReview(
  pctx: PhaseContext,
  skipReview: boolean,
  pipeline = "implement",
): Promise<void> {
  if (!pctx.stages.some((s) => s.name === "refactorer")) pctx.stages.push(emptyStage("refactorer"));
  await pctx.runAgentFn(
    "refactorer",
    "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit and push if changed.",
    { ...pctx.agentOpts, pipeline },
  );

  if (!skipReview) {
    await reviewAndFix(pctx, pipeline);
  }
}

/** Run the implementor agent and check for blocked signal. Returns blocked reason or null. */
export async function runImplementorPhase(pctx: PhaseContext, prompt: string): Promise<string | null> {
  cleanSignal(pctx.cwd, "blocked");
  await pctx.runAgentFn("implementor", prompt, pctx.agentOpts);

  if (signalExists(pctx.cwd, "blocked")) {
    return readSignal(pctx.cwd, "blocked") ?? "";
  }
  return null;
}

/** Build the implementor agent prompt from issue context and plan. */
export function buildImplementorPrompt(
  issueContext: string,
  plan: string,
  customPrompt: string | undefined,
  resolved: ResolvedIssue,
  autonomous?: boolean,
): string {
  const isGitHub = resolved.source === "github" && resolved.number > 0;
  const planSection = plan ? `\n\nIMPLEMENTATION PLAN:\n${plan}` : "";
  const customPromptSection = customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}` : "";
  const branchNote = resolved.branch
    ? `\n- You should be on branch: ${resolved.branch} — do NOT create or switch branches.`
    : "\n- Do NOT create or switch branches.";
  const closeNote = isGitHub
    ? `\n- The PR body MUST end with a blank line then 'Closes #${resolved.number}' on its own line (not inline with other text), so the issue auto-closes on merge.`
    : `\n- The PR body should reference Jira issue ${resolved.key}.`;
  const unresolvedNote = autonomous
    ? `\n- If the plan has unresolved questions, resolve them yourself using sensible defaults. Do NOT stop and wait.`
    : "";

  return `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}${customPromptSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit, push, and create a PR.\n\nCONSTRAINTS:${branchNote}${closeNote}${unresolvedNote}\n- If blocked, write BLOCKED.md with the reason and stop.`;
}
