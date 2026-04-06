import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  type StageResult,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";
import { buildPrBody, resolveIssue } from "../utils/git.js";
import { ensurePr, mergePr, returnToMain, setupBranch } from "../utils/git-workflow.js";
import { askCustomPrompt, setForgeflowStatus } from "../utils/ui.js";
import {
  buildImplementorPrompt,
  type PhaseContext,
  refactorAndReview,
  reviewAndFix,
  runImplementorPhase,
} from "./implement-phases.js";
import { runPlanning } from "./planning.js";

export async function runImplement(
  issueArg: string,
  pctx: PipelineContext,
  flags: { skipPlan: boolean; skipReview: boolean; autonomous?: boolean } = {
    skipPlan: false,
    skipReview: false,
  },
) {
  const { cwd, onUpdate, ctx } = pctx;
  const interactive = ctx.hasUI && !flags.autonomous;
  const resolved = await resolveIssue(cwd, issueArg || undefined);
  if (typeof resolved === "string") return pipelineResult(resolved, "implement", []);

  const isGH = resolved.source === "github" && resolved.number > 0;
  const issueLabel = isGH ? `#${resolved.number}: ${resolved.title}` : `${resolved.key}: ${resolved.title}`;
  const issueContext = isGH
    ? `Issue #${resolved.number}: ${resolved.title}\n\n${resolved.body}`
    : `Jira ${resolved.key}: ${resolved.title}\n\n${resolved.body}`;

  if (!flags.autonomous && (resolved.number || resolved.key))
    setForgeflowStatus(ctx, `${isGH ? `#${resolved.number}` : resolved.key} ${resolved.title} · ${resolved.branch}`);

  const customPrompt = await askCustomPrompt(ctx, interactive);

  const buildPhaseContext = (stages: StageResult[]): PhaseContext => ({
    cwd,
    agentOpts: toAgentOpts(pctx, { stages, pipeline: "implement" }),
    stages,
  });

  // --- Resumability ---
  if (resolved.existingPR) {
    const stages: StageResult[] = [];
    if (!flags.skipReview) await reviewAndFix(buildPhaseContext(stages));
    return pipelineResult(`Resumed ${issueLabel} — PR #${resolved.existingPR} already exists.`, "implement", stages);
  }

  // --- Branch setup ---
  if (resolved.branch) {
    const branchResult = await setupBranch(cwd, resolved.branch);
    if (branchResult.status === "resumed") {
      await ensurePr(cwd, resolved.title, buildPrBody(cwd, resolved), resolved.branch);
      const stages: StageResult[] = [];
      await refactorAndReview(buildPhaseContext(stages), flags.skipReview);
      return pipelineResult(`Resumed ${issueLabel} — pushed existing commits and created PR.`, "implement", stages);
    }
    if (branchResult.status === "failed")
      return pipelineResult(branchResult.error || `Failed to switch to ${resolved.branch}.`, "implement", [], true);
  }

  // --- Planning ---
  const stages: StageResult[] = [];
  if (!flags.skipPlan)
    stages.push(emptyStage("planner"), emptyStage("architecture-reviewer"), emptyStage("architecture-judge"));
  stages.push(emptyStage("implementor"), emptyStage("refactorer"));

  let plan = "";
  if (!flags.skipPlan) {
    const planResult = await runPlanning(issueContext, customPrompt, {
      ...pctx,
      interactive,
      stages,
    });
    if (planResult.failed) return pipelineResult(`Planner failed: ${planResult.plan}`, "implement", stages, true);
    if (planResult.cancelled) return pipelineResult("Implementation cancelled.", "implement", stages);
    plan = planResult.plan;
  }

  // --- Implementor ---
  const prompt = buildImplementorPrompt(issueContext, plan, customPrompt, resolved, flags.autonomous);
  const blocked = await runImplementorPhase(buildPhaseContext(stages), prompt);
  if (blocked != null) return pipelineResult(`Implementor blocked:\n${blocked}`, "implement", stages, true);

  // --- Refactor + Review ---
  await refactorAndReview(buildPhaseContext(stages), flags.skipReview);

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
    onUpdate?.(pipelineResult("Pipeline complete", "implement", stages));
  }

  return pipelineResult(`Implementation of ${issueLabel} complete.`, "implement", stages);
}
