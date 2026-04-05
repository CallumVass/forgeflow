import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { TOOLS_ALL } from "@callumvass/forgeflow-shared/constants";
import { exec } from "@callumvass/forgeflow-shared/exec";
import { cleanSignal, readSignal, signalExists } from "@callumvass/forgeflow-shared/signals";
import { emptyStage, type PipelineContext, type StageResult, toAgentOpts } from "@callumvass/forgeflow-shared/types";
import { AGENTS_DIR } from "../resolve.js";
import { buildPrBody, type ResolvedIssue, resolveIssue } from "../utils/git.js";
import { ensurePr, mergePr, returnToMain, setupBranch } from "../utils/git-workflow.js";
import { setForgeflowStatus } from "../utils/ui.js";
import { runPlanning } from "./planning.js";
import { runReviewPipeline } from "./review-orchestrator.js";

function result(text: string, stages: StageResult[], isError?: boolean) {
  return {
    content: [{ type: "text" as const, text }],
    details: { pipeline: "implement", stages },
    ...(isError ? { isError } : {}),
  };
}

export async function runImplement(
  issueArg: string,
  pctx: PipelineContext,
  flags: { skipPlan: boolean; skipReview: boolean; autonomous?: boolean; customPrompt?: string } = {
    skipPlan: false,
    skipReview: false,
  },
) {
  const { cwd, onUpdate, ctx } = pctx;
  const interactive = ctx.hasUI && !flags.autonomous;
  const resolved = await resolveIssue(cwd, issueArg || undefined);
  if (typeof resolved === "string") return result(resolved, []);

  const isGH = resolved.source === "github" && resolved.number > 0;
  const issueLabel = isGH ? `#${resolved.number}: ${resolved.title}` : `${resolved.key}: ${resolved.title}`;
  const issueContext = isGH
    ? `Issue #${resolved.number}: ${resolved.title}\n\n${resolved.body}`
    : `Jira ${resolved.key}: ${resolved.title}\n\n${resolved.body}`;

  if (!flags.autonomous && (resolved.number || resolved.key))
    setForgeflowStatus(ctx, `${isGH ? `#${resolved.number}` : resolved.key} ${resolved.title} · ${resolved.branch}`);

  if (interactive && !flags.customPrompt) {
    const extra = await ctx.ui.input("Additional instructions?", "Skip");
    if (extra?.trim()) flags.customPrompt = extra.trim();
  }

  // --- Resumability ---
  if (resolved.existingPR) {
    const stages: StageResult[] = [];
    if (!flags.skipReview) await reviewAndFix(pctx, stages);
    return result(`Resumed ${issueLabel} — PR #${resolved.existingPR} already exists.`, stages);
  }

  // --- Branch setup ---
  if (resolved.branch) {
    const branchResult = await setupBranch(cwd, resolved.branch);
    if (branchResult.status === "resumed") {
      await ensurePr(cwd, resolved.title, buildPrBody(cwd, resolved), resolved.branch);
      const stages: StageResult[] = [];
      await refactorAndReview(pctx, stages, flags.skipReview);
      return result(`Resumed ${issueLabel} — pushed existing commits and created PR.`, stages);
    }
    if (branchResult.status === "failed")
      return result(branchResult.error || `Failed to switch to ${resolved.branch}.`, [], true);
  }

  // --- Planning ---
  const stages: StageResult[] = [];
  if (!flags.skipPlan) stages.push(emptyStage("planner"));
  stages.push(emptyStage("implementor"), emptyStage("refactorer"));

  let plan = "";
  if (!flags.skipPlan) {
    const planResult = await runPlanning(issueContext, flags.customPrompt, {
      ...pctx,
      interactive,
      stages,
    });
    if (planResult.failed) return result(`Planner failed: ${planResult.plan}`, stages, true);
    if (planResult.cancelled) return result("Implementation cancelled.", stages);
    plan = planResult.plan;
  }

  // --- Implementor ---
  cleanSignal(cwd, "blocked");
  const prompt = buildImplementorPrompt(issueContext, plan, flags.customPrompt, resolved, flags.autonomous);
  const opts = toAgentOpts(pctx, { agentsDir: AGENTS_DIR, stages, pipeline: "implement" });
  await runAgent("implementor", prompt, { ...opts, tools: TOOLS_ALL });

  if (signalExists(cwd, "blocked"))
    return result(`Implementor blocked:\n${readSignal(cwd, "blocked") ?? ""}`, stages, true);

  // --- Refactor + Review ---
  await refactorAndReview(pctx, stages, flags.skipReview);

  // --- PR + Merge ---
  let prNumber = 0;
  if (resolved.branch) {
    const prResult = await ensurePr(cwd, resolved.title, buildPrBody(cwd, resolved), resolved.branch);
    prNumber = prResult.number;
  }

  if (!flags.autonomous && prNumber > 0) {
    const mergeStage = emptyStage("merge");
    stages.push(mergeStage);
    await mergePr(cwd, prNumber);
    await returnToMain(cwd);
    mergeStage.status = "done";
    mergeStage.output = `Merged PR #${prNumber}`;
    onUpdate?.({ content: [{ type: "text", text: "Pipeline complete" }], details: { pipeline: "implement", stages } });
  }

  return result(`Implementation of ${issueLabel} complete.`, stages);
}

// --- Private helpers ---

async function reviewAndFix(pctx: PipelineContext, stages: StageResult[], pipeline = "implement"): Promise<void> {
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

async function refactorAndReview(
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

function buildImplementorPrompt(
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
