import {
  type AnyCtx,
  cleanSignal,
  emptyStage,
  runAgent,
  type StageResult,
  TOOLS_ALL,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";
import type { ResolvedIssue } from "../utils/git.js";
import { runReviewInline } from "./review.js";

/**
 * Run the implementor agent with the given prompt.
 */
export async function runImplementor(
  cwd: string,
  prompt: string,
  signal: AbortSignal,
  stages: StageResult[],
  onUpdate: AnyCtx,
): Promise<void> {
  await runAgent("implementor", prompt, {
    agentsDir: AGENTS_DIR,
    cwd,
    signal,
    stages,
    pipeline: "implement",
    onUpdate,
    tools: TOOLS_ALL,
  });
}

/**
 * Run review and fix any findings via implementor.
 */
export async function reviewAndFix(
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  stages: StageResult[],
  pipeline = "implement",
): Promise<void> {
  const reviewResult = await runReviewInline(cwd, signal, onUpdate, ctx, stages);
  if (reviewResult.isError) {
    const findings = reviewResult.content[0]?.type === "text" ? reviewResult.content[0].text : "";
    stages.push(emptyStage("fix-findings"));
    await runAgent(
      "implementor",
      `Fix the following code review findings:\n\n${findings}\n\nRULES:\n- Fix only the cited issues. Do not refactor or improve unrelated code.\n- Run the check command after fixes.\n- Commit and push the fixes.`,
      { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline, onUpdate, tools: TOOLS_ALL, stageName: "fix-findings" },
    );
    cleanSignal(cwd, "findings");
  }
}

/**
 * Run refactorer then review+fix. Shared by fresh implementation and resume paths.
 */
export async function refactorAndReview(
  cwd: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  stages: StageResult[],
  skipReview: boolean,
  pipeline = "implement",
): Promise<void> {
  if (!stages.some((s) => s.name === "refactorer")) stages.push(emptyStage("refactorer"));
  await runAgent(
    "refactorer",
    "Review code added in this branch (git diff main...HEAD). Refactor if clear wins exist. Run checks after changes. Commit and push if changed.",
    { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline, onUpdate, tools: TOOLS_ALL },
  );

  if (!skipReview) {
    await reviewAndFix(cwd, signal, onUpdate, ctx, stages, pipeline);
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
