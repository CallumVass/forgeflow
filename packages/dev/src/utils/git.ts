import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "./exec.js";

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
 * Checkout a branch, creating it if it doesn't exist.
 */
export async function ensureBranch(cwd: string, branch: string): Promise<void> {
  const currentBranch = await exec("git branch --show-current", cwd);
  if (currentBranch === branch) return;
  const localExists = await exec(`git rev-parse --verify ${branch} 2>/dev/null && echo yes || echo no`, cwd);
  if (localExists === "yes") {
    await exec(`git checkout ${branch}`, cwd);
    return;
  }
  // Check for remote-only branch and track it
  await exec("git fetch origin", cwd);
  const remoteExists = await exec(`git rev-parse --verify origin/${branch} 2>/dev/null && echo yes || echo no`, cwd);
  if (remoteExists === "yes") {
    await exec(`git checkout -b ${branch} origin/${branch}`, cwd);
  } else {
    await exec(`git checkout -b ${branch}`, cwd);
  }
}

/**
 * Resolve which issue to implement:
 * 1. Jira key (CUS-123) → fetch from jira-cli
 * 2. Numeric GitHub issue → fetch from gh
 * 3. On a feature branch → extract from branch name
 */
export async function resolveIssue(cwd: string, issueArg?: string): Promise<ResolvedIssue | string> {
  // Explicit Jira key
  if (issueArg && JIRA_KEY_RE.test(issueArg)) {
    return resolveJiraIssue(cwd, issueArg);
  }

  // Explicit GitHub issue number
  if (issueArg && /^\d+$/.test(issueArg)) {
    return resolveGitHubIssue(cwd, parseInt(issueArg, 10));
  }

  // Free-text description (not a number or Jira key)
  if (issueArg) {
    return { source: "github", key: "", number: 0, title: issueArg, body: issueArg, branch: "" };
  }

  // Detect from branch name
  const branch = await exec("git branch --show-current", cwd);

  const jiraMatch = branch.match(JIRA_BRANCH_RE);
  if (jiraMatch) {
    // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
    return resolveJiraIssue(cwd, jiraMatch[1]!, branch);
  }

  const ghMatch = branch.match(/(?:feat\/)?issue-(\d+)/);
  if (ghMatch) {
    // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
    return resolveGitHubIssue(cwd, parseInt(ghMatch[1]!, 10));
  }

  return `On branch "${branch}" — can't detect issue. Use /implement <issue#> or /implement <JIRA-KEY>.`;
}

async function resolveGitHubIssue(cwd: string, issueNum: number): Promise<ResolvedIssue | string> {
  const issueJson = await exec(`gh issue view ${issueNum} --json number,title,body`, cwd);
  if (!issueJson) return `Could not fetch issue #${issueNum}.`;

  let issue: { number: number; title: string; body: string };
  try {
    issue = JSON.parse(issueJson);
  } catch {
    return `Could not parse issue #${issueNum}.`;
  }

  const branch = `feat/issue-${issueNum}`;
  const prJson = await exec(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  const existingPR = prJson && prJson !== "null" ? parseInt(prJson, 10) : undefined;

  return { source: "github", key: String(issueNum), ...issue, branch, existingPR };
}

async function resolveJiraIssue(
  cwd: string,
  jiraKey: string,
  existingBranch?: string,
): Promise<ResolvedIssue | string> {
  const raw = await exec(`jira issue view ${jiraKey} --raw`, cwd);
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

  const prJson = await exec(`gh pr list --head "${branch}" --json number --jq '.[0].number'`, cwd);
  const existingPR = prJson && prJson !== "null" ? parseInt(prJson, 10) : undefined;

  return { source: "jira", key: jiraKey, number: 0, title, body, branch, existingPR };
}
