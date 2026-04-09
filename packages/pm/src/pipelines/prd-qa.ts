import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { missingPrdResult, prdExists, promptBootstrapPrd, runQaLoop } from "../prd/index.js";

export async function runPrdQa(maxIterations: number, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "prd-qa", (innerPctx) => runPrdQaInner(maxIterations, innerPctx));
}

async function runPrdQaInner(maxIterations: number, pctx: PipelineContext) {
  if (!prdExists(pctx.cwd)) {
    const created = await promptBootstrapPrd(pctx);
    if (!created || !prdExists(pctx.cwd)) return missingPrdResult("prd-qa");
  }

  const stages: StageResult[] = [];
  const qaResult = await runQaLoop({
    ...pctx,
    stages,
    pipeline: "prd-qa",
    maxIterations,
    uiReviewMode: "final",
    finalReviewTitle: "PRD refinement complete — Review PRD",
    criticPrompt:
      "Review PRD.md for completeness. For greenfield projects, ensure the PRD captures the intended product shape plus the chosen high-level technical direction that materially affects implementation, such as stack/ecosystem, app or runtime framework, testing baseline, persistence, auth, hosting, and any user-stated provider or library preferences. The greenfield direction should be concrete enough that issue creation can produce one small initial scaffold/bootstrap issue and then feature slices without leaving project-shaping choices for the implementor to improvise. For project-shaping decisions, the PRD should name the chosen option and may include brief alternatives considered. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
  });

  if (qaResult.error) return pipelineResult(qaResult.error.text, "prd-qa", stages, true);
  if (!qaResult.accepted)
    return pipelineResult(`PRD refinement did not complete after ${maxIterations} iterations.`, "prd-qa", stages);
  return pipelineResult(
    "PRD refinement complete. Review PRD.md, make any final adjustments, then run /create-gh-issues.",
    "prd-qa",
    stages,
  );
}
