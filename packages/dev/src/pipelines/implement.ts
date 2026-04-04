import {
  type AnyCtx,
  cleanSignal,
  emptyStage,
  readSignal,
  runAgent,
  type StageResult,
  signalExists,
  TOOLS_ALL,
  TOOLS_READONLY,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";
import { exec } from "../utils/exec.js";
import { ensureBranch, resolveIssue } from "../utils/git.js";
import { setForgeflowStatus } from "../utils/ui.js";
import { runReviewInline } from "./review.js";

/**
 * Run review and fix any findings via implementor.
 */
async function reviewAndFix(
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
 * Run refactorer then review+fix. Shared by fresh implementation and resume-from-branch paths.
 */
async function refactorAndReview(
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
 * Parse unresolved questions from the plan and prompt the user for answers.
 * Returns the plan with answers injected inline.
 */
async function resolveQuestions(plan: string, ctx: AnyCtx): Promise<string> {
  const sectionMatch = plan.match(/### Unresolved Questions\n([\s\S]*?)(?=\n###|$)/);
  if (!sectionMatch) return plan;

  const section = sectionMatch[1] ?? "";
  const questions: string[] = [];
  for (const m of section.matchAll(/^- (.+)$/gm)) {
    if (m[1]) questions.push(m[1]);
  }

  if (questions.length === 0) return plan;

  let updatedSection = section;
  for (const q of questions) {
    const answer = await ctx.ui.input(`${q}`, "Skip to use defaults");
    if (answer != null && answer.trim() !== "") {
      updatedSection = updatedSection.replace(`- ${q}`, `- ${q}\n  **Answer:** ${answer.trim()}`);
    }
  }

  return plan.replace(`### Unresolved Questions\n${section}`, `### Unresolved Questions\n${updatedSection}`);
}

export async function runImplement(
  cwd: string,
  issueArg: string,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
  flags: { skipPlan: boolean; skipReview: boolean; autonomous?: boolean; customPrompt?: string } = {
    skipPlan: false,
    skipReview: false,
  },
) {
  const interactive = ctx.hasUI && !flags.autonomous;
  const resolved = await resolveIssue(cwd, issueArg || undefined);
  if (typeof resolved === "string") {
    return { content: [{ type: "text" as const, text: resolved }], details: { pipeline: "implement", stages: [] } };
  }

  const isGitHub = resolved.source === "github" && resolved.number > 0;
  const issueLabel = isGitHub ? `#${resolved.number}: ${resolved.title}` : `${resolved.key}: ${resolved.title}`;

  // Status line for standalone /implement (implement-all manages its own)
  if (!flags.autonomous && (resolved.number || resolved.key)) {
    const tag = isGitHub ? `#${resolved.number}` : resolved.key;
    setForgeflowStatus(ctx, `${tag} ${resolved.title} · ${resolved.branch}`);
  }

  const issueContext = isGitHub
    ? `Issue #${resolved.number}: ${resolved.title}\n\n${resolved.body}`
    : `Jira ${resolved.key}: ${resolved.title}\n\n${resolved.body}`;

  const customPromptSection = flags.customPrompt ? `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${flags.customPrompt}` : "";

  // --- Resumability: skip to review if work already exists ---
  if (resolved.existingPR) {
    const stages: StageResult[] = [];
    if (!flags.skipReview) {
      await reviewAndFix(cwd, signal, onUpdate, ctx, stages);
    }
    return {
      content: [{ type: "text" as const, text: `Resumed ${issueLabel} — PR #${resolved.existingPR} already exists.` }],
      details: { pipeline: "implement", stages },
    };
  }

  if (resolved.branch) {
    const branchExists = await exec(
      `git rev-parse --verify ${resolved.branch} 2>/dev/null && echo yes || echo no`,
      cwd,
    );
    if (branchExists === "yes") {
      await ensureBranch(cwd, resolved.branch);
      const ahead = await exec(`git rev-list main..${resolved.branch} --count`, cwd);
      if (parseInt(ahead, 10) > 0) {
        await exec(`git push -u origin ${resolved.branch}`, cwd);
        const prBody = isGitHub ? `Closes #${resolved.number}` : `Jira: ${resolved.key}`;
        await exec(`gh pr create --title "${resolved.title}" --body "${prBody}" --head ${resolved.branch}`, cwd);

        const stages: StageResult[] = [];
        await refactorAndReview(cwd, signal, onUpdate, ctx, stages, flags.skipReview);
        return {
          content: [{ type: "text" as const, text: `Resumed ${issueLabel} — pushed existing commits and created PR.` }],
          details: { pipeline: "implement", stages },
        };
      }
    }
  }

  // --- Fresh implementation ---
  const stageList: StageResult[] = [];
  if (!flags.skipPlan) stageList.push(emptyStage("planner"));
  stageList.push(emptyStage("implementor"));
  stageList.push(emptyStage("refactorer"));
  const stages = stageList;
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "implement", onUpdate };

  let plan = "";

  if (!flags.skipPlan) {
    const planResult = await runAgent(
      "planner",
      `Plan the implementation for this issue by producing a sequenced list of test cases.\n\n${issueContext}${customPromptSection}`,
      { ...opts, tools: TOOLS_READONLY },
    );

    if (planResult.status === "failed") {
      return {
        content: [{ type: "text" as const, text: `Planner failed: ${planResult.output}` }],
        details: { pipeline: "implement", stages },
        isError: true,
      };
    }
    plan = planResult.output;

    // Interactive mode: let user review/edit the plan before proceeding
    if (interactive && plan) {
      const edited = await ctx.ui.editor(`Review implementation plan for ${issueLabel}`, plan);
      if (edited != null && edited !== plan) {
        plan = edited;
      }

      // Surface unresolved questions one-by-one for user answers
      plan = await resolveQuestions(plan, ctx);

      const action = await ctx.ui.select("Plan ready. What next?", ["Approve and implement", "Cancel"]);
      if (action === "Cancel" || action == null) {
        return {
          content: [{ type: "text" as const, text: "Implementation cancelled." }],
          details: { pipeline: "implement", stages },
        };
      }
    }
  }

  // Create/checkout feature branch if on main
  if (resolved.branch) {
    const currentBranch = await exec("git branch --show-current", cwd);
    if (currentBranch === "main" || currentBranch === "master") {
      const dirty = await exec("git status --porcelain", cwd);
      if (dirty) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot switch to ${resolved.branch} — working tree is dirty. Please commit or stash your changes first.`,
            },
          ],
          details: { pipeline: "implement", stages: [] },
          isError: true,
        };
      }
      await ensureBranch(cwd, resolved.branch);
      const afterBranch = await exec("git branch --show-current", cwd);
      if (afterBranch !== resolved.branch) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to switch to ${resolved.branch} (still on ${afterBranch}). Check git state and retry.`,
            },
          ],
          details: { pipeline: "implement", stages: [] },
          isError: true,
        };
      }
    }
  }

  // Clean up stale blockers
  cleanSignal(cwd, "blocked");

  // Implementor
  const planSection = plan ? `\n\nIMPLEMENTATION PLAN:\n${plan}` : "";
  const branchNote = resolved.branch
    ? `\n- You should be on branch: ${resolved.branch} — do NOT create or switch branches.`
    : "\n- Do NOT create or switch branches.";
  const prNote = resolved.existingPR ? `\n- PR #${resolved.existingPR} already exists for this branch.` : "";
  const closeNote = isGitHub
    ? `\n- The PR body MUST include 'Closes #${resolved.number}' so the issue auto-closes on merge.`
    : `\n- The PR body should reference Jira issue ${resolved.key}.`;
  const unresolvedNote = flags.autonomous
    ? `\n- If the plan has unresolved questions, resolve them yourself using sensible defaults. Do NOT stop and wait.`
    : "";

  await runAgent(
    "implementor",
    `Implement the following issue using strict TDD (red-green-refactor).\n\n${issueContext}${planSection}${customPromptSection}\n\nWORKFLOW:\n1. Read the codebase.\n2. TDD${plan ? " following the plan" : ""}.\n3. Refactor after all tests pass.\n4. Run check command, fix failures.\n5. Commit, push, and create a PR.\n\nCONSTRAINTS:${branchNote}${prNote}${closeNote}${unresolvedNote}\n- If blocked, write BLOCKED.md with the reason and stop.`,
    { ...opts, tools: TOOLS_ALL },
  );

  // Check for blocker
  if (signalExists(cwd, "blocked")) {
    const reason = readSignal(cwd, "blocked") ?? "";
    return {
      content: [{ type: "text" as const, text: `Implementor blocked:\n${reason}` }],
      details: { pipeline: "implement", stages },
      isError: true,
    };
  }

  // Refactor + review
  await refactorAndReview(cwd, signal, onUpdate, ctx, stages, flags.skipReview);

  // Ensure PR exists — agent may have skipped or failed `gh pr create`
  let prNumber = "";
  if (resolved.branch) {
    await exec(`git push -u origin ${resolved.branch}`, cwd);
    prNumber = await exec(`gh pr list --head "${resolved.branch}" --json number --jq '.[0].number'`, cwd);
    if (!prNumber || prNumber === "null") {
      const prBody = isGitHub ? `Closes #${resolved.number}` : `Jira: ${resolved.key}`;
      await exec(`gh pr create --title "${resolved.title}" --body "${prBody}" --head ${resolved.branch}`, cwd);
      prNumber = await exec(`gh pr list --head "${resolved.branch}" --json number --jq '.[0].number'`, cwd);
    }
  }

  // Squash-merge, delete branch, update local main (skip when called from implement-all)
  if (!flags.autonomous && prNumber && prNumber !== "null") {
    const mergeStage = emptyStage("merge");
    stages.push(mergeStage);
    await exec(`gh pr merge ${prNumber} --squash --delete-branch`, cwd);
    await exec("git checkout main && git pull", cwd);
    mergeStage.status = "done";
    mergeStage.output = `Merged PR #${prNumber}`;
    onUpdate?.({
      content: [{ type: "text", text: "Pipeline complete" }],
      details: { pipeline: "implement", stages },
    });
  }

  return {
    content: [{ type: "text" as const, text: `Implementation of ${issueLabel} complete.` }],
    details: { pipeline: "implement", stages },
  };
}
