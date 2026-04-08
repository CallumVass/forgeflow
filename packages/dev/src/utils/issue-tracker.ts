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
 * 1. Jira key (CUS-123) → fetch from jira-cli
 * 2. Numeric GitHub issue → fetch from gh
 * 3. On a feature branch → extract from branch name
 *
 * Takes an `{ execFn, execSafeFn }` pair — these field names match
 * `PipelineContext`, so callers can pass `pctx` directly. Tests pass spies to
 * capture every `git`/`gh`/`jira` invocation without spawning real sub-processes.
 *
 * Does NOT inspect PR state. Callers that need to know whether a PR already
 * exists for the resolved branch must call `findPrNumber` themselves.
 */
export async function resolveIssue(
  cwd: string,
  issueArg: string | undefined,
  deps: IssueTrackerDeps,
): Promise<ResolvedIssue | string> {
  // Explicit Jira key
  if (issueArg && JIRA_KEY_RE.test(issueArg)) {
    return resolveJiraIssue(cwd, issueArg, deps);
  }

  // Explicit GitHub issue number
  if (issueArg && /^\d+$/.test(issueArg)) {
    return resolveGitHubIssue(cwd, parseInt(issueArg, 10), deps);
  }

  // Free-text description (not a number or Jira key)
  if (issueArg) {
    return { source: "github", key: "", number: 0, title: issueArg, body: issueArg, branch: "" };
  }

  // Detect from branch name
  const branch = await deps.execFn("git branch --show-current", cwd);

  const jiraMatch = branch.match(JIRA_BRANCH_RE);
  if (jiraMatch) {
    // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
    return resolveJiraIssue(cwd, jiraMatch[1]!, deps, branch);
  }

  const ghMatch = branch.match(/(?:feat\/)?issue-(\d+)/);
  if (ghMatch) {
    // biome-ignore lint/style/noNonNullAssertion: match[1] guaranteed by regex
    return resolveGitHubIssue(cwd, parseInt(ghMatch[1]!, 10), deps);
  }

  return `On branch "${branch}" — can't detect issue. Use /implement <issue#> or /implement <JIRA-KEY>.`;
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

async function resolveJiraIssue(
  cwd: string,
  jiraKey: string,
  deps: IssueTrackerDeps,
  existingBranch?: string,
): Promise<ResolvedIssue | string> {
  const raw = await deps.execSafeFn(`jira issue view ${jiraKey} --raw`, cwd);
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

  return { source: "jira", key: jiraKey, number: 0, title, body, branch };
}
