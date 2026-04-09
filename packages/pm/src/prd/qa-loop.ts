import {
  emptyStage,
  type PipelineContext,
  type StageResult,
  signalExists,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";
import { promptEditPrd } from "./document.js";

export type SignalExistsFn = (cwd: string, signal: string) => boolean;

export interface QaLoopOptions extends PipelineContext {
  stages: StageResult[];
  pipeline: string;
  maxIterations: number;
  criticPrompt: string;
  signalExistsFn?: SignalExistsFn;
  uiReviewMode?: "per-iteration" | "final";
  finalReviewTitle?: string;
}

interface QaLoopResult {
  accepted: boolean;
  error?: { text: string };
}

export async function runQaLoop(opts: QaLoopOptions): Promise<QaLoopResult> {
  const { cwd, stages, pipeline, ctx, maxIterations, criticPrompt, runAgentFn } = opts;

  const signalExistsFn = opts.signalExistsFn ?? (signalExists as SignalExistsFn);
  const uiReviewMode = opts.uiReviewMode ?? "per-iteration";
  const finalReviewTitle = opts.finalReviewTitle ?? "PRD refinement complete — Review PRD";

  const agentOpts = toAgentOpts(opts, { stages, pipeline });

  let accepted = false;

  for (let i = 1; i <= maxIterations; i++) {
    stages.push(emptyStage("prd-critic"));
    const criticResult = await runAgentFn("prd-critic", criticPrompt, agentOpts);

    if (!signalExistsFn(cwd, "questions")) {
      if (criticResult.status === "failed") {
        return { accepted: false, error: { text: `Critic failed.\nStderr: ${criticResult.stderr.slice(0, 300)}` } };
      }
      accepted = true;
      break;
    }

    stages.push(emptyStage("prd-architect"));
    await runAgentFn(
      "prd-architect",
      "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
      agentOpts,
    );

    stages.push(emptyStage("prd-integrator"));
    await runAgentFn(
      "prd-integrator",
      "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
      agentOpts,
    );

    if (ctx.hasUI && uiReviewMode === "per-iteration") {
      await promptEditPrd(opts, `QA iteration ${i} — Review PRD`);
      const action = await ctx.ui.select("PRD updated. What next?", ["Continue refining", "Accept PRD"]);
      if (action === "Accept PRD" || action == null) return { accepted: true };
    }
  }

  if (accepted && ctx.hasUI && uiReviewMode === "final") {
    await promptEditPrd(opts, finalReviewTitle);
  }

  return { accepted };
}
