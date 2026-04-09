import type { IssueInfo } from "./issue-query.js";

/**
 * Get issue numbers whose dependencies (referenced as #N in the
 * ## Dependencies section) are satisfied.
 */
export function getReadyIssues(issues: IssueInfo[], completed: Set<number>): number[] {
  return issues
    .filter((issue) => {
      if (completed.has(issue.number)) return false;
      const parts = issue.body.split("## Dependencies");
      if (parts.length < 2) return true;
      const depSection = parts[1]?.split("\n## ")[0] ?? "";
      const deps = [...depSection.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1] ?? "0", 10));
      return deps.every((d) => completed.has(d));
    })
    .map((i) => i.number);
}
