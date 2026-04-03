import * as fs from "node:fs";
import { TOOLS_ALL, TOOLS_NO_EDIT } from "../constants.js";
import { runAgent } from "../run-agent.js";
import { type AnyCtx, emptyStage, type StageResult } from "../types.js";
import { signalExists } from "../utils/signals.js";

export async function runPrdQa(cwd: string, maxIterations: number, signal: AbortSignal, onUpdate: AnyCtx, ctx: AnyCtx) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "prd-qa", stages: [] },
    };
  }

  const stages: StageResult[] = [];
  const opts = { cwd, signal, stages, pipeline: "prd-qa", onUpdate };

  for (let i = 1; i <= maxIterations; i++) {
    // Critic
    stages.push(emptyStage("prd-critic"));
    const criticResult = await runAgent(
      "prd-critic",
      "Review PRD.md for completeness. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
      { ...opts, tools: TOOLS_NO_EDIT },
    );

    // No QUESTIONS.md = critic considers PRD complete
    if (!signalExists(cwd, "questions")) {
      if (criticResult.status === "failed") {
        return {
          content: [{ type: "text" as const, text: `Critic failed.\nStderr: ${criticResult.stderr.slice(0, 300)}` }],
          details: { pipeline: "prd-qa", stages },
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: "PRD refinement complete. Ready for /create-issues." }],
        details: { pipeline: "prd-qa", stages },
      };
    }

    // Architect
    stages.push(emptyStage("prd-architect"));
    await runAgent(
      "prd-architect",
      "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
      { ...opts, tools: TOOLS_ALL },
    );

    // Integrator — incorporate answers into PRD before approval gate
    stages.push(emptyStage("prd-integrator"));
    await runAgent(
      "prd-integrator",
      "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
      opts,
    );

    // Approval gate — show PRD in editor, user can review/edit then decide
    if (ctx.hasUI) {
      const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
      const edited = await ctx.ui.editor(`Iteration ${i} — Review PRD (edit or close to continue)`, prdContent);

      // If user edited, write changes back
      if (edited != null && edited !== prdContent) {
        fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
      }

      const action = await ctx.ui.select("PRD updated. What next?", ["Continue refining", "Accept PRD"]);
      if (action === "Accept PRD" || action == null) {
        return {
          content: [{ type: "text" as const, text: "PRD accepted." }],
          details: { pipeline: "prd-qa", stages },
        };
      }
    }
  }

  return {
    content: [{ type: "text" as const, text: `PRD refinement did not complete after ${maxIterations} iterations.` }],
    details: { pipeline: "prd-qa", stages },
  };
}
