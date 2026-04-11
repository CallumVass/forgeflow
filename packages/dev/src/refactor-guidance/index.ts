const sharedRefactorHeuristics = `Shared refactor heuristics:
- duplicated logic or repeated test setup introduced or expanded by the change
- touched files or functions that grew large enough to split at an obvious seam
- repeated validation, mapping, or error-handling patterns worth extracting
- obvious opportunities to reuse an existing helper or deepen a shallow abstraction
- cross-package duplicated types or fixtures that should become shared types or test helpers

Seam guidance:
- Use language- and framework-appropriate thresholds as guidance rather than rigid universal limits.
- As a rough heuristic, consider splitting when a general module/class/file grows beyond ~300-400 lines, a UI component file grows beyond ~200 lines, or a single function/method grows beyond ~50 lines.
- Split only when there is a clear seam. Do not force a split that makes the code harder to follow.

Quality bar:
- Prefer small, high-confidence changes over broad clean-ups.
- No premature abstractions: if the seam is unclear or the variations matter, leave it alone.
- Ignore pre-existing repo-wide issues unless this change clearly worsens them.`;

export function buildRefactorerTask(diffRange = "git diff main...HEAD"): string {
  return `Review code added in this branch (${diffRange}). Refactor if clear wins exist.

${sharedRefactorHeuristics}

Action mode rules:
- Read the diff first, then scan nearby code for duplication or clear seam lines.
- Preserve behaviour and public interfaces unless you update every caller.
- Run checks after each refactoring change.
- Commit and push if you made changes.
- If there is nothing worth changing, say exactly "No refactoring needed".`;
}

export function buildRefactorReviewTask(diff: string): string {
  return `Review the following diff for clear, non-speculative refactor opportunities:

${diff}

${sharedRefactorHeuristics}

Review mode rules:
- Focus ONLY on code touched by the diff and nearby repeated patterns.
- Do NOT change code, commit, or push.
- Report only opportunities with a concrete payoff and a clear seam.
- Ignore taste-based rewrites and broad clean-ups.
- If nothing rises above that bar, output exactly NO_FINDINGS.`;
}
