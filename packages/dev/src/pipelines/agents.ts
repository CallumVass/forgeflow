import {
  cleanSignal,
  emptyStage,
  exec,
  type PipelineContext,
  runAgent,
  type StageResult,
  TOOLS_ALL,
  toAgentOpts,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";
import type { ResolvedIssue } from "../utils/git.js";
import { runReviewPipeline } from "./review-orchestrator.js";

/**
 * Run the implementor agent with the given prompt.
 */
export async function runImplementor(prompt: string, pctx: PipelineContext, stages: StageResult[]): Promise<void> {
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline: "implement" });
  await runAgent("implementor", prompt, { ...opts, tools: TOOLS_ALL });
}

/**
 * Run review and fix any findings via implementor.
 */
export async function reviewAndFix(
  pctx: PipelineContext,
  stages: StageResult[],
  pipeline = "implement",
): Promise<void> {
  const diff = await exec("git diff main...HEAD", pctx.cwd);
  if (!diff) return;
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline });
  const reviewResult = await runReviewPipeline(diff, opts);
  if (!reviewResult.passed) {
    const findings = reviewResult.findings ?? "";
    stages.push(emptyStage("fix-findings"));
    await runAgent(
      "implementor",
      `Fix the following code review findings:\n\n${findings}\n\nRULES:\n- Fix only the cited issues. Do not refactor or improve unrelated code.\n- Run the check command after fixes.\n- Commit and push the fixes.`,
      { ...opts, tools: TOOLS_ALL, stageName: "fix-findings" },
    );
    cleanSignal(pctx.cwd, "findings");
  }
}

/**
 * Run refactorer then review+fix. Shared by fresh implementation and resume paths.
 */
export async function refactorAndReview(
  pctx: PipelineContext,
  stages: StageResult[],
  skipReview: boolean,
  pipeline = "implement",
): Promise<void> {
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline });
  if (!stages.some((s) => s.name === "refactorer")) stages.push(emptyStage("refactorer"));
  await runAgent(
    "refactorer",
    "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit and push if changed.",
    { ...opts, tools: TOOLS_ALL },
  );

  if (!skipReview) {
    await reviewAndFix(pctx, stages, pipeline);
  }
}

/**
 * Build the implementor agent prompt from issue context, plan, and flags.
 */
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
  const prNote = resolved.existingPR ? `\n- PR #${resolved.existingPR} already exists for this branch.` : "";
  const closeNote = isGitHub
    ? `\n- The PR body MUST end with a blank line then 'Closes #${resolved.number}' on its own line (not inline with other text), so the issue auto-closes on merge.`
    : `\n- The PR body should reference Jira issue ${resolved.key}.`;
  const unresolvedNote = autonomous
    ? `\n- If the plan has unresolved questions, resolve them yourself using sensible defaults. Do NOT stop and wait.`
    : "";

  return `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}${customPromptSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit, push, and create a PR.\n\nCONSTRAINTS:${branchNote}${prNote}${closeNote}${unresolvedNote}\n- If blocked, write BLOCKED.md with the reason and stop.`;
}
