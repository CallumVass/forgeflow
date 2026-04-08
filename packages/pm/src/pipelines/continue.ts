import * as fs from "node:fs";
import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  type StageResult,
  TOOLS_ALL,
  TOOLS_NO_EDIT,
  toAgentOpts,
} from "@callumvass/forgeflow-shared/pipeline";
import { runQaLoop } from "./qa-loop.js";

function updatePrompt(description: string) {
  const focus = description ? ` The user wants the next phase to focus on: ${description}` : "";
  return `You are updating a PRD for the next phase of work on an existing project.

1. Read PRD.md to understand the product spec.
2. Explore the codebase thoroughly — file structure, existing features, git log, tests, what's actually built.
3. Compare what the PRD describes vs what exists in code.
4. Rewrite PRD.md with this structure:
   - Keep the Problem Statement, Goals, Tech Stack, and other top-level sections
   - Add or update a \`## Done\` section: a concise summary of what's already built (based on your codebase exploration, not just what the PRD previously said). Keep it brief — bullet points or short paragraphs describing completed user-facing capabilities.
   - Add or update a \`## Next\` section: the upcoming work.${focus}
   - The \`## Next\` section should follow all PRD quality standards — user stories, functional requirements, edge cases, scope boundaries.
   - Remove any phase markers like 'Phase 1 (Complete)' — use Done/Next instead.

5. Keep the total PRD under 200 lines. The Done section should be especially concise — it's context, not spec.

CRITICAL RULES:
- Do NOT include code blocks, type definitions, or implementation detail.
- The Done section summarizes capabilities ('users can create runs and see streaming output'), not architecture ('Hono server with SSE endpoints').
- The Next section must be specific enough to create vertical-slice issues from.
- If no description was provided for Next, infer it from the existing PRD's roadmap, scope boundaries, or TODO items.`;
}

/**
 * Continue pipeline: update PRD with Done/Next, run QA loop, create issues.
 */
export async function runContinue(description: string, maxIterations: number, pctx: PipelineContext) {
  const { cwd, ctx } = pctx;
  if (!fs.existsSync(`${cwd}/PRD.md`)) return pipelineResult("PRD.md not found.", "continue", []);

  const stages: StageResult[] = [];
  const agentOpts = toAgentOpts(pctx, { stages, pipeline: "continue" });

  // Phase 1: Update PRD with Done/Next structure
  stages.push(emptyStage("prd-architect"));
  const archResult = await pctx.runAgentFn("prd-architect", updatePrompt(description), {
    ...agentOpts,
    tools: TOOLS_ALL,
  });
  if (archResult.status === "failed") {
    return pipelineResult(`PRD update failed.\nStderr: ${archResult.stderr.slice(0, 300)}`, "continue", stages, true);
  }

  if (ctx.hasUI) {
    const prdContent = fs.readFileSync(`${cwd}/PRD.md`, "utf-8");
    const edited = await ctx.ui.editor("Review updated PRD (Done/Next structure)", prdContent);
    if (edited != null && edited !== prdContent) fs.writeFileSync(`${cwd}/PRD.md`, edited, "utf-8");
    const action = await ctx.ui.select("PRD updated with Done/Next. What next?", ["Continue to QA", "Stop here"]);
    if (action === "Stop here" || action == null)
      return pipelineResult("PRD updated. Stopped before QA.", "continue", stages);
  }

  // Phase 2: PRD QA loop on the Next section
  const qaResult = await runQaLoop({
    ...pctx,
    stages,
    pipeline: "continue",
    maxIterations,
    criticPrompt:
      "Review PRD.md for completeness — focus on the ## Next section. If it needs refinement, create QUESTIONS.md. If it's complete, do NOT create QUESTIONS.md.",
  });
  if (qaResult.error) return pipelineResult(qaResult.error.text, "continue", stages, true);

  // Phase 3: Create issues from the Next section
  stages.push(emptyStage("gh-issue-creator"));
  await pctx.runAgentFn(
    "gh-issue-creator",
    "Decompose PRD.md into vertical-slice GitHub issues. Focus on the ## Next section — the ## Done section is context only. Read the issue-template skill for the standard format.",
    { ...agentOpts, tools: TOOLS_NO_EDIT },
  );

  return pipelineResult("Continue pipeline complete. PRD updated, QA'd, and issues created.", "continue", stages);
}
