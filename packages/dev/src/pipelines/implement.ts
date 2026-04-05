import { cleanSignal, readSignal, signalExists } from "@callumvass/forgeflow-shared/signals";
import { emptyStage, type PipelineContext, type StageResult } from "@callumvass/forgeflow-shared/types";
import { buildPrBody, resolveIssue } from "../utils/git.js";
import { ensurePr, mergePr, returnToMain, setupBranch } from "../utils/git-workflow.js";
import { setForgeflowStatus } from "../utils/ui.js";
import { buildImplementorPrompt, refactorAndReview, reviewAndFix, runImplementor } from "./agents.js";
import { runPlanning } from "./planning.js";

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
  await runImplementor(prompt, pctx, stages);

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
