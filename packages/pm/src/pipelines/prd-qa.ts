import * as fs from "node:fs";
import type { PipelineContext, StageResult } from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";
import { runQaLoop } from "./qa-loop.js";

function result(text: string, pipeline: string, stages: StageResult[], isError?: boolean) {
  return {
    content: [{ type: "text" as const, text }],
    details: { pipeline, stages },
    ...(isError ? { isError } : {}),
  };
}

export async function runPrdQa(maxIterations: number, pctx: PipelineContext) {
  if (!fs.existsSync(`${pctx.cwd}/PRD.md`)) return result("PRD.md not found.", "prd-qa", []);

  const stages: StageResult[] = [];
  const qaResult = await runQaLoop({
    ...pctx,
    stages,
    pipeline: "prd-qa",
    agentsDir: AGENTS_DIR,
    maxIterations,
    criticPrompt:
      "Review PRD.md for completeness. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
  });

  if (qaResult.error) return result(qaResult.error.text, "prd-qa", stages, true);
  if (!qaResult.accepted)
    return result(`PRD refinement did not complete after ${maxIterations} iterations.`, "prd-qa", stages);
  return result("PRD refinement complete. Ready for /create-gh-issues.", "prd-qa", stages);
}
