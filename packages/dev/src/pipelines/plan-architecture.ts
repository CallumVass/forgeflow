/**
 * Architecture critique helpers for the planning pipeline.
 *
 * Architectural recommendations are parsed from the architecture-reviewer
 * output and appended to the plan as an "### Architectural Notes" section.
 * The reviewer itself is invoked inline from `runPlanning` so it can
 * participate in the planning sub-chain's fork lineage.
 */

import type { ArchitectureCandidate } from "./architecture.js";

/**
 * Append architectural recommendations to the plan.
 * Returns the plan unchanged when recommendations is empty.
 */
export function appendArchitecturalNotes(plan: string, recommendations: ArchitectureCandidate[]): string {
  if (recommendations.length === 0) return plan;

  const notes = recommendations.map((r) => r.body).join("\n\n");
  return `${plan}\n\n### Architectural Notes\n\n${notes}`;
}
