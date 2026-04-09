import { fetchJiraIssueViaOauth } from "@callumvass/forgeflow-shared/atlassian";
import type { ExecFn } from "@callumvass/forgeflow-shared/pipeline";

/**
 * Pair of shell-execution functions injected into issue-tracker helpers.
 * `execFn` throws on non-zero exit; `execSafeFn` returns empty string on failure.
 * Names match `PipelineContext.execFn` / `PipelineContext.execSafeFn` so callers
 * can pass `pctx` directly via structural subtyping.
 */
interface IssueTrackerDeps {
  execFn: ExecFn;
  execSafeFn: ExecFn;
}

export interface ResolvedIssue {
  source: "github" | "jira";
  key: string; // "42" for GH, "CUS-123" for Jira
  number: number; // GH issue number, 0 for Jira
  title: string;
  body: string;
  branch: string;
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
 * 1. Jira key (CUS-123) → fetch via Atlassian OAuth
 * 2. Numeric GitHub issue → fetch from gh
 * 3. On a feature branch → extract from branch name
 *
 * Takes an `{ execFn, execSafeFn }` pair — these field names match
 * `PipelineContext`, so callers can pass `pctx` directly. Tests pass spies to
 * capture every `git`/`gh` invocation without spawning real sub-processes.
 *
 * Does NOT inspect PR state. Callers that need to know whether a PR already
 * exists for the resolved branch must call `findPrNumber` themselves.
 */
export async function resolveIssue(
  cwd: string,
  issueArg: string | undefined,
  deps: IssueTrackerDeps,
): Promise<ResolvedIssue | string> {
  if (issueArg && JIRA_KEY_RE.test(issueArg)) {
    return resolveJiraIssue(issueArg, existingBranch(undefined));
  }

  if (issueArg && /^\d+$/.test(issueArg)) {
    return resolveGitHubIssue(cwd, parseInt(issueArg, 10), deps);
  }

  if (issueArg) {
    return { source: "github", key: "", number: 0, title: issueArg, body: issueArg, branch: "" };
  }

  const branch = await deps.execFn("git branch --show-current", cwd);

  const jiraMatch = branch.match(JIRA_BRANCH_RE);
  if (jiraMatch) {
    return resolveJiraIssue(jiraMatch[1] ?? "", existingBranch(branch));
  }

  const ghMatch = branch.match(/(?:feat\/)?issue-(\d+)/);
  if (ghMatch) {
    return resolveGitHubIssue(cwd, parseInt(ghMatch[1] ?? "0", 10), deps);
  }

  return `On branch "${branch}" — can't detect issue. Use /implement <issue#> or /implement <JIRA-KEY>.`;
}

function existingBranch(branch: string | undefined): string | undefined {
  return branch && branch.length > 0 ? branch : undefined;
}

async function resolveGitHubIssue(
  cwd: string,
  issueNum: number,
  deps: IssueTrackerDeps,
): Promise<ResolvedIssue | string> {
  const issueJson = await deps.execSafeFn(`gh issue view ${issueNum} --json number,title,body`, cwd);
  if (!issueJson) return `Could not fetch issue #${issueNum}.`;

  let issue: { number: number; title: string; body: string };
  try {
    issue = JSON.parse(issueJson);
  } catch {
    return `Could not parse issue #${issueNum}.`;
  }

  return { source: "github", key: String(issueNum), ...issue, branch: `feat/issue-${issueNum}` };
}

async function resolveJiraIssue(jiraKey: string, existingBranch?: string): Promise<ResolvedIssue | string> {
  if (!jiraKey) return "Could not determine Jira issue key.";

  const issue = await fetchJiraIssueViaOauth(jiraKey);
  if (typeof issue === "string") return issue;

  const branch = existingBranch ?? `feat/${jiraKey}-${slugify(issue.title)}`;
  return { source: "jira", key: jiraKey, number: 0, title: issue.title, body: issue.body, branch };
}
