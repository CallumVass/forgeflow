/**
 * Architecture critique for the planning pipeline.
 * Chains architecture-reviewer → architecture-judge to validate recommendations,
 * then appends surviving ones to the plan as an "### Architectural Notes" section.
 */

import { TOOLS_READONLY } from "@callumvass/forgeflow-shared/constants";
import type { RunAgentFn, RunAgentOpts } from "@callumvass/forgeflow-shared/stage";
import { parseCandidates, parseJudgeVerdict } from "./architecture.js";

/**
 * Append validated architectural recommendations to the plan.
 * Returns the plan unchanged when recommendations is empty.
 */
export function appendArchitecturalNotes(plan: string, recommendations: { label: string; body: string }[]): string {
  if (recommendations.length === 0) return plan;

  const notes = recommendations.map((r) => r.body).join("\n\n");
  return `${plan}\n\n### Architectural Notes\n\n${notes}`;
}

/**
 * Run architecture critique on a plan: reviewer produces recommendations,
 * judge validates each one, surviving recommendations are appended to the plan.
 * Fail-open: if reviewer produces nothing or judge rejects everything, plan is unchanged.
 */
export async function runArchitectureCritique(
  plan: string,
  issueContext: string,
  opts: {
    runAgentFn: RunAgentFn;
    agentOpts: Omit<RunAgentOpts, "tools">;
  },
): Promise<string> {
  const { runAgentFn, agentOpts } = opts;

  const reviewerPrompt = `Review this implementation plan against the existing codebase. Focus ONLY on what the plan touches — this is not a full architecture audit.

ISSUE CONTEXT:
${issueContext}

IMPLEMENTATION PLAN:
${plan}

Look for:
- Existing shared utilities or patterns in the codebase the plan should reuse instead of creating new ones
- Modules the plan would push over 300 lines
- Duplication the plan would create across packages
- Type safety concerns (any escape hatches, missing interfaces)
- Opportunities to use or extend existing shared abstractions

Present numbered recommendations in candidate format. If the plan already follows good patterns, say "No architectural recommendations" and stop.`;

  const reviewResult = await runAgentFn("architecture-reviewer", reviewerPrompt, {
    ...agentOpts,
    tools: TOOLS_READONLY,
  });

  if (reviewResult.status === "failed") return plan;

  const candidates = parseCandidates(reviewResult.output);
  if (candidates.length === 0) return plan;

  const validated: { label: string; body: string }[] = [];

  for (const candidate of candidates) {
    const judgeResult = await runAgentFn(
      "architecture-judge",
      `Validate this architecture finding against the actual codebase.\n\nCANDIDATE:\n${candidate.body}\n\nFULL ANALYSIS:\n${reviewResult.output}`,
      { ...agentOpts, tools: TOOLS_READONLY },
    );

    if (parseJudgeVerdict(judgeResult.output) !== "reject") {
      validated.push(candidate);
    }
  }

  return appendArchitecturalNotes(plan, validated);
}
