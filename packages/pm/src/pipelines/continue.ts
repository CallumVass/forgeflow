import * as fs from "node:fs";
import {
  type AnyCtx,
  emptyStage,
  runAgent,
  type StageResult,
  signalExists,
  TOOLS_ALL,
  TOOLS_NO_EDIT,
} from "@callumvass/forgeflow-shared";
import { AGENTS_DIR } from "../resolve.js";

/**
 * Continue pipeline: update PRD with Done/Next, run QA loop, create issues.
 */
export async function runContinue(
  cwd: string,
  description: string,
  maxIterations: number,
  signal: AbortSignal,
  onUpdate: AnyCtx,
  ctx: AnyCtx,
) {
  if (!fs.existsSync(`${cwd}/PRD.md`)) {
    return {
      content: [{ type: "text" as const, text: "PRD.md not found." }],
      details: { pipeline: "continue", stages: [] },
    };
  }

  const stages: StageResult[] = [];
  const opts = { agentsDir: AGENTS_DIR, cwd, signal, stages, pipeline: "continue", onUpdate };

  // Phase 1: Update PRD with Done/Next structure
  stages.push(emptyStage("prd-architect"));
  const updatePrompt = `You are updating a PRD for the next phase of work on an existing project.

1. Read PRD.md to understand the product spec.
2. Explore the codebase thoroughly — file structure, existing features, git log, tests, what's actually built.
3. Compare what the PRD describes vs what exists in code.
4. Rewrite PRD.md with this structure:
   - Keep the Problem Statement, Goals, Tech Stack, and other top-level sections
   - Add or update a \`## Done\` section: a concise summary of what's already built (based on your codebase exploration, not just what the PRD previously said). Keep it brief — bullet points or short paragraphs describing completed user-facing capabilities.
   - Add or update a \`## Next\` section: the upcoming work.${description ? ` The user wants the next phase to focus on: ${description}` : ""}
   - The \`## Next\` section should follow all PRD quality standards — user stories, functional requirements, edge cases, scope boundaries.
   - Remove any phase markers like 'Phase 1 (Complete)' — use Done/Next instead.

5. Keep the total PRD under 200 lines. The Done section should be especially concise — it's context, not spec.

CRITICAL RULES:
- Do NOT include code blocks, type definitions, or implementation detail.
- The Done section summarizes capabilities ('users can create runs and see streaming output'), not architecture ('Hono server with SSE endpoints').
- The Next section must be specific enough to create vertical-slice issues from.
- If no description was provided for Next, infer it from the existing PRD's roadmap, scope boundaries, or TODO items.`;

  const archResult = await runAgent("prd-architect", updatePrompt, { ...opts, tools: TOOLS_ALL });
  if (archResult.status === "failed") {
    return {
      content: [{ type: "text" as const, text: `PRD update failed.\nStderr: ${archResult.stderr.slice(0, 300)}` }],
      details: { pipeline: "continue", stages },
      isError: true,
    };
  }

  // Approval gate after PRD update
  if (ctx.hasUI) {
    const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
    const edited = await ctx.ui.editor("Review updated PRD (Done/Next structure)", prdContent);
    if (edited != null && edited !== prdContent) {
      fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
    }
    const action = await ctx.ui.select("PRD updated with Done/Next. What next?", ["Continue to QA", "Stop here"]);
    if (action === "Stop here" || action == null) {
      return {
        content: [{ type: "text" as const, text: "PRD updated. Stopped before QA." }],
        details: { pipeline: "continue", stages },
      };
    }
  }

  // Phase 2: PRD QA loop on the Next section
  for (let i = 1; i <= maxIterations; i++) {
    stages.push(emptyStage("prd-critic"));
    const criticResult = await runAgent(
      "prd-critic",
      "Review PRD.md for completeness — focus on the ## Next section. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
      { ...opts, tools: TOOLS_NO_EDIT },
    );

    if (!signalExists(cwd, "questions")) {
      if (criticResult.status === "failed") {
        return {
          content: [{ type: "text" as const, text: `Critic failed.\nStderr: ${criticResult.stderr.slice(0, 300)}` }],
          details: { pipeline: "continue", stages },
          isError: true,
        };
      }
      break;
    }

    stages.push(emptyStage("prd-architect"));
    await runAgent(
      "prd-architect",
      "Read PRD.md and answer all questions in QUESTIONS.md. Write answers inline in QUESTIONS.md.",
      { ...opts, tools: TOOLS_ALL },
    );

    stages.push(emptyStage("prd-integrator"));
    await runAgent(
      "prd-integrator",
      "Incorporate answers from QUESTIONS.md into PRD.md, then delete QUESTIONS.md.",
      opts,
    );

    if (ctx.hasUI) {
      const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
      const edited = await ctx.ui.editor(`QA iteration ${i} — Review PRD`, prdContent);
      if (edited != null && edited !== prdContent) {
        fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
      }
      const action = await ctx.ui.select("PRD updated. What next?", ["Continue refining", "Accept PRD"]);
      if (action === "Accept PRD" || action == null) break;
    }
  }

  // Phase 3: Create issues from the Next section
  stages.push(emptyStage("gh-issue-creator"));
  await runAgent(
    "gh-issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Focus on the ## Next section — the ## Done section is context only. Read the issue-template skill for the standard format.",
    { ...opts, tools: TOOLS_NO_EDIT },
  );

  return {
    content: [{ type: "text" as const, text: "Continue pipeline complete. PRD updated, QA'd, and issues created." }],
    details: { pipeline: "continue", stages },
  };
}
