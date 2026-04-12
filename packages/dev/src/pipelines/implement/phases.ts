import type { ResolvedIssue } from "../../issues/index.js";

/** Input shape for `buildImplementorPrompt`. */
interface ImplementorPromptInput {
  issueContext: string;
  plan: string;
  customPrompt: string | undefined;
  resolved: ResolvedIssue;
  autonomous?: boolean;
  /**
   * When `true`, the implementor is cold-started (no forked planner
   * session in its history) and the task prompt includes the full
   * issue context and plan text inline. When `false`, the implementor
   * was forked from the planning sub-chain and already has the issue
   * context + plan in its conversation history, so the task prompt
   * becomes a thin directive pointing at what it should do with them.
   */
  isColdStart: boolean;
}

/**
 * Build the implementor's task prompt.
 *
 * Two shapes, selected by `isColdStart`:
 *
 * - **Cold start** (`--skip-plan`, or a resume path): the prompt
 *   contains the full issue context, the plan (if any), the custom
 *   prompt, and the TDD workflow instructions. Essentially the
 *   pre-fork behaviour.
 *
 * - **Forked from planning**: the prompt is a thin directive that
 *   references "the plan you see in this session's prior turns" and
 *   lists constraints only. Issue context, plan text, custom prompt,
 *   and architectural notes are all already in the implementor's
 *   conversation history via fork inheritance.
 */
export function buildImplementorPrompt(input: ImplementorPromptInput): string {
  const { issueContext, plan, customPrompt, resolved, autonomous, isColdStart } = input;

  const isGitHub = resolved.source === "github" && resolved.number > 0;
  const branchNote = resolved.branch
    ? `\n- You should be on branch: ${resolved.branch} — do NOT create or switch branches.`
    : "\n- Do NOT create or switch branches.";
  const closeNote = isGitHub
    ? `\n- The PR body MUST end with a blank line then 'Closes #${resolved.number}' on its own line (not inline with other text), so the issue auto-closes on merge.`
    : `\n- The PR body should reference Jira issue ${resolved.key}.`;
  const unresolvedNote = autonomous
    ? `\n- If the plan has unresolved questions, resolve them yourself using sensible defaults. Do NOT stop and wait.`
    : "";
  const constraints = `\n\nCONSTRAINTS:${branchNote}${closeNote}${unresolvedNote}\n- If blocked, write BLOCKED.md with the reason and stop.`;

  if (!isColdStart) {
    // Forked from planning. Everything the implementor needs is already
    // in its session history; the task prompt just tells it what to do
    // with that context.
    return `Implement the plan you see in this session's prior turns using strict TDD (red-green-refactor).\n\nYour conversation history already contains the planner's codebase exploration, the architecture-reviewer's critique, and any Forgeflow stage handoff notes. Use those inherited handoffs before re-reading the same files. Re-read only to verify a detail or inspect code the planning chain did not cover. Treat tool results (reads, bash, grep) as ground truth; treat prior assistant turns as working notes rather than binding decisions. Your authoritative inputs are the plan text and the failing tests you are about to write.\n\nWORKFLOW:\n1. TDD through the plan one behaviour at a time.\n2. Refactor after all tests pass.\n3. Run the check command, fix failures.\n4. Commit, push, and create a PR.${constraints}`;
  }

  // Cold-start path: caller needs the fat prompt because nothing is in history.
  const planSection = plan ? `\n\nIMPLEMENTATION PLAN:\n${plan}` : "";
  const customPromptSection = customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}` : "";

  return `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}${customPromptSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit, push, and create a PR.${constraints}`;
}
