import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedIssue } from "../issues/index.js";

const PR_TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  ".github/PULL_REQUEST_TEMPLATE/pull_request_template.md",
];

/**
 * Build a PR body using the repo's PR template if one exists,
 * otherwise fall back to the default close/reference line.
 *
 * GitHub issues get `Closes #<number>`; Jira issues get `Jira: <key>`.
 */
export function buildPrBody(cwd: string, issue: ResolvedIssue): string {
  const isGitHub = issue.source === "github" && issue.number > 0;
  const closeRef = isGitHub ? `Closes #${issue.number}` : `Jira: ${issue.key}`;

  for (const rel of PR_TEMPLATE_PATHS) {
    const abs = path.join(cwd, rel);
    try {
      const template = fs.readFileSync(abs, "utf-8");
      return `${closeRef}\n\n${template}`;
    } catch {}
  }

  return closeRef;
}
