import * as fs from "node:fs";
import * as path from "node:path";
import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";
import { findPrNumber } from "./git-workflow.js";

/**
 * Pair of shell-execution functions injected into git helpers.
 * `exec` throws on non-zero exit; `execSafe` returns empty string on failure.
 */
interface GitExecPair {
  exec: ExecFn;
  execSafe: ExecFn;
}

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
 */
export function buildPrBody(cwd: string, issue: ResolvedIssue): string {
  const isGitHub = issue.source === "github" && issue.number > 0;
  const defaultBody = isGitHub ? `Closes #${issue.number}` : `Jira: ${issue.key}`;

  for (const rel of PR_TEMPLATE_PATHS) {
    const abs = path.join(cwd, rel);
    try {
      const template = fs.readFileSync(abs, "utf-8");
      const closeRef = isGitHub ? `Closes #${issue.number}` : `Jira: ${issue.key}`;
      return `${closeRef}\n\n${template}`;
    } catch {}
  }

  return defaultBody;
}

export interface ResolvedIssue {
  source: "github" | "jira";
  key: string; // "42" for GH, "CUS-123" for Jira
  number: number; // GH issue number, 0 for Jira
  title: string;
  body: string;
  branch: string;
  existingPR?: number;
}

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen)
    .replace(/-$/, "");
}

const JIRA_KEY_RE = /^[A-Z]+-\d+$/;
const JIRA_BRANCH_RE = /feat\/([A-Z]+-\d+)/;

/**
 * Resolve which issue to implement:
 * 1. Jira key (CUS-123) → fetch from jira-cli
 * 2. Numeric GitHub issue → fetch from gh
 * 3. On a feature branch → extract from branch name
 *
 * Takes an `{ exec, execSafe }` pair so callers (pipelines) can pass
 * `pctx.execFn` / `pctx.execSafeFn`. Tests pass spies to capture every
 * `git`/`gh`/`jira` invocation without spawning real sub-processes.
 */
export async function resolveIssue(
  cwd: string,
  issueArg: string | undefined,
  execFns: GitExecPair,
): Promise<ResolvedIssue | string> {
  // Explicit Jira key
  if (issueArg && JIRA_KEY_RE.test(issueArg)) {
    return resolveJiraIssue(cwd, issueArg, execFns);
  }

  // Explicit GitHub issue number
  if (issueArg && /^\d+$/.test(issueArg)) {
    return resolveGitHubIssue(cwd, parseInt(issueArg, 10), execFns);
  }

  // Free-text description (not a number or Jira key)
  if (issueArg) {
    return { source: "github", key: "", number: 0, title: issueArg, body: issueArg, branch: "" };
  }

  // Detect from branch name
  const branch = await execFns.exec("git branch --show-current", cwd);

  const jiraMatch = branch.match(JIRA_BRANCH_RE);
  if (jiraMatch) {
    // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
    return resolveJiraIssue(cwd, jiraMatch[1]!, execFns, branch);
  }

  const ghMatch = branch.match(/(?:feat\/)?issue-(\d+)/);
  if (ghMatch) {
    // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
    return resolveGitHubIssue(cwd, parseInt(ghMatch[1]!, 10), execFns);
  }

  return `On branch "${branch}" — can't detect issue. Use /implement <issue#> or /implement <JIRA-KEY>.`;
}

async function resolveGitHubIssue(
  cwd: string,
  issueNum: number,
  execFns: GitExecPair,
): Promise<ResolvedIssue | string> {
  const issueJson = await execFns.execSafe(`gh issue view ${issueNum} --json number,title,body`, cwd);
  if (!issueJson) return `Could not fetch issue #${issueNum}.`;

  let issue: { number: number; title: string; body: string };
  try {
    issue = JSON.parse(issueJson);
  } catch {
    return `Could not parse issue #${issueNum}.`;
  }

  const branch = `feat/issue-${issueNum}`;
  const existingPR = (await findPrNumber(cwd, branch, execFns.exec)) ?? undefined;

  return { source: "github", key: String(issueNum), ...issue, branch, existingPR };
}

async function resolveJiraIssue(
  cwd: string,
  jiraKey: string,
  execFns: GitExecPair,
  existingBranch?: string,
): Promise<ResolvedIssue | string> {
  const raw = await execFns.execSafe(`jira issue view ${jiraKey} --raw`, cwd);
  if (!raw) return `Could not fetch Jira issue ${jiraKey}.`;

  // biome-ignore lint/suspicious/noExplicitAny: Jira JSON shape varies by instance
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return `Could not parse Jira issue ${jiraKey}.`;
  }

  const fields = data.fields ?? {};
  const title = fields.summary ?? jiraKey;

  // Build body from available Jira fields
  const bodyParts: string[] = [];
  if (fields.description) bodyParts.push(fields.description);
  if (fields.acceptance_criteria) bodyParts.push(`## Acceptance Criteria\n${fields.acceptance_criteria}`);
  if (fields.status?.name) bodyParts.push(`**Status:** ${fields.status.name}`);
  if (fields.priority?.name) bodyParts.push(`**Priority:** ${fields.priority.name}`);
  if (fields.story_points != null) bodyParts.push(`**Story Points:** ${fields.story_points}`);
  if (fields.sprint?.name) bodyParts.push(`**Sprint:** ${fields.sprint.name}`);

  const body = bodyParts.join("\n\n");
  const branch = existingBranch ?? `feat/${jiraKey}-${slugify(title)}`;

  const existingPR = (await findPrNumber(cwd, branch, execFns.exec)) ?? undefined;

  return { source: "jira", key: jiraKey, number: 0, title, body, branch, existingPR };
}
