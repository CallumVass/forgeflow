import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import { setupBranch } from "../../git/branch-lifecycle.js";
import { findPrNumber } from "../../git/pr-lifecycle.js";
import { type ResolvedIssue, resolveIssue } from "../../issues/tracker.js";

/**
 * Discriminated union describing how `runImplement` should resume work for
 * the requested issue. Replaces the implicit existing-PR / `branchResult.status
 * === "resumed"` / "fresh" ladder that used to live inline in `runImplement`.
 */
export type ResumeMode =
  | { kind: "existing-pr"; prNumber: number }
  | { kind: "resume-branch" }
  | { kind: "fresh" }
  | { kind: "failed"; error: string };

export interface IssuePlan {
  resolved: ResolvedIssue;
  resume: ResumeMode;
  issueLabel: string;
  issueContext: string;
}

/**
 * Resolve which issue to implement and the correct resume mode for it.
 *
 * Encapsulates the `resolveIssue` → `findPrNumber` → `setupBranch` →
 * label-building sequence that used to live inline in `runImplement`. Calls
 * `findPrNumber` here (rather than inside `resolveIssue`) so the issue-tracker
 * layer stays oblivious of PR state. Short-circuits on an existing PR (no
 * branch mutation) and does not call `setupBranch` if the issue cannot be
 * resolved at all.
 */
export async function resolveIssuePlan(
  issueArg: string,
  pctx: PipelineContext,
): Promise<IssuePlan | { error: string }> {
  const { cwd, execFn } = pctx;
  const resolved = await resolveIssue(cwd, issueArg || undefined, pctx);
  if (typeof resolved === "string") return { error: resolved };

  const isGH = resolved.source === "github" && resolved.number > 0;
  const issueLabel = isGH ? `#${resolved.number}: ${resolved.title}` : `${resolved.key}: ${resolved.title}`;
  const issueContext = isGH
    ? `Issue #${resolved.number}: ${resolved.title}\n\n${resolved.body}`
    : `Jira ${resolved.key}: ${resolved.title}\n\n${resolved.body}`;

  // Existing PR → review-and-fix only. Do NOT mutate the branch.
  // Inspect PR state at the layering boundary, not inside resolveIssue.
  const existingPr = resolved.branch ? await findPrNumber(cwd, resolved.branch, execFn) : null;
  if (existingPr != null) {
    return {
      resolved,
      resume: { kind: "existing-pr", prNumber: existingPr },
      issueLabel,
      issueContext,
    };
  }

  // No branch (e.g. free-text description) → fresh path with nothing to set up.
  if (!resolved.branch) {
    return { resolved, resume: { kind: "fresh" }, issueLabel, issueContext };
  }

  const branchResult = await setupBranch(cwd, resolved.branch, execFn);
  if (branchResult.status === "resumed") {
    return { resolved, resume: { kind: "resume-branch" }, issueLabel, issueContext };
  }
  if (branchResult.status === "failed") {
    return {
      resolved,
      resume: {
        kind: "failed",
        error: branchResult.error || `Failed to switch to ${resolved.branch}.`,
      },
      issueLabel,
      issueContext,
    };
  }

  return { resolved, resume: { kind: "fresh" }, issueLabel, issueContext };
}
