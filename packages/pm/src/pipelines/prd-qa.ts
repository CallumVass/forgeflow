import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { missingPrdResult, prdExists } from "../prd-document.js";
import { runQaLoop } from "./qa-loop.js";

export async function runPrdQa(maxIterations: number, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "prd-qa", (innerPctx) => runPrdQaInner(maxIterations, innerPctx));
}

async function runPrdQaInner(maxIterations: number, pctx: PipelineContext) {
  if (!prdExists(pctx.cwd)) return missingPrdResult("prd-qa");

  const stages: StageResult[] = [];
  const qaResult = await runQaLoop({
    ...pctx,
    stages,
    pipeline: "prd-qa",
    maxIterations,
    criticPrompt:
      "Review PRD.md for completeness. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
  });

  if (qaResult.error) return pipelineResult(qaResult.error.text, "prd-qa", stages, true);
  if (!qaResult.accepted)
    return pipelineResult(`PRD refinement did not complete after ${maxIterations} iterations.`, "prd-qa", stages);
  return pipelineResult("PRD refinement complete. Ready for /create-gh-issues.", "prd-qa", stages);
}
