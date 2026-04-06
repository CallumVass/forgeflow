import * as fs from "node:fs";
import { resolveRunAgent } from "@callumvass/forgeflow-shared/agent";
import {
  emptyStage,
  type PipelineContext,
  type RunAgentFn,
  type StageResult,
  signalExists,
  TOOLS_ALL,
  TOOLS_NO_EDIT,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";

export type SignalExistsFn = (cwd: string, signal: string) => boolean;

export interface QaLoopOptions extends PipelineContext {
  stages: StageResult[];
  pipeline: string;
  maxIterations: number;
  criticPrompt: string;
  runAgentFn?: RunAgentFn;
  signalExistsFn?: SignalExistsFn;
}

interface QaLoopResult {
  accepted: boolean;
  error?: { text: string };
}

export async function runQaLoop(opts: QaLoopOptions): Promise<QaLoopResult> {
  const { cwd, stages, pipeline, ctx, maxIterations, criticPrompt } = opts;

  const runAgentFn = await resolveRunAgent(opts.runAgentFn);
  const signalExistsFn = opts.signalExistsFn ?? (signalExists as SignalExistsFn);

  const agentOpts = toAgentOpts(opts, { stages, pipeline });

  for (let i = 1; i <= maxIterations; i++) {
    stages.push(emptyStage("prd-critic"));
    const criticResult = await runAgentFn("prd-critic", criticPrompt, { ...agentOpts, tools: TOOLS_NO_EDIT });

    if (!signalExistsFn(cwd, "questions")) {
      if (criticResult.status === "failed") {
        return { accepted: false, error: { text: `Critic failed.\nStderr: ${criticResult.stderr.slice(0, 300)}` } };
      }
      return { accepted: true };
    }

    stages.push(emptyStage("prd-architect"));
    await runAgentFn(
      "prd-architect",
      "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
      { ...agentOpts, tools: TOOLS_ALL },
    );

    stages.push(emptyStage("prd-integrator"));
    await runAgentFn(
      "prd-integrator",
      "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
      agentOpts,
    );

    if (ctx.hasUI) {
      const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
      const edited = await ctx.ui.editor(`QA iteration ${i} — Review PRD`, prdContent);
      if (edited != null && edited !== prdContent) {
        fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
      }
      const action = await ctx.ui.select("PRD updated. What next?", ["Continue refining", "Accept PRD"]);
      if (action === "Accept PRD" || action == null) return { accepted: true };
    }
  }

  return { accepted: false };
}
