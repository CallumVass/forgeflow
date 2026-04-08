/**
 * Architecture critique for the planning pipeline.
 * Runs architecture-reviewer on a plan and appends any parsed recommendations
 * to the plan as an "### Architectural Notes" section.
 */

import type { RunAgentFn, RunAgentOpts } from "@callumvass/forgeflow-shared/pipeline";
import { type ArchitectureCandidate, parseCandidates } from "./architecture.js";

/**
 * Append architectural recommendations to the plan.
 * Returns the plan unchanged when recommendations is empty.
 */
export function appendArchitecturalNotes(plan: string, recommendations: ArchitectureCandidate[]): string {
  if (recommendations.length === 0) return plan;

  const notes = recommendations.map((r) => r.body).join("\n\n");
  return `${plan}\n\n### Architectural Notes\n\n${notes}`;
}

/**
 * Run architecture critique on a plan: reviewer produces recommendations,
 * which are appended to the plan.
 * Fail-open: if the reviewer fails or produces nothing parseable, the plan is unchanged.
 */
export async function runArchitectureCritique(
  plan: string,
  issueContext: string,
  opts: {
    runAgentFn: RunAgentFn;
    agentOpts: RunAgentOpts;
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

  const reviewResult = await runAgentFn("architecture-reviewer", reviewerPrompt, agentOpts);

  if (reviewResult.status === "failed") return plan;

  const candidates = parseCandidates(reviewResult.output);
  return appendArchitecturalNotes(plan, candidates);
}
