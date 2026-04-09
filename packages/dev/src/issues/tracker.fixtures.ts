import type { ResolvedIssue } from "./tracker.js";

/**
 * Test fixture factory for a GitHub-sourced `ResolvedIssue`. Callers override
 * only the fields they care about; anything not overridden takes the default
 * "issue 42 / Test issue" shape used across the dev package's tests.
 */
export function makeGitHubResolvedIssue(overrides: Partial<ResolvedIssue> = {}): ResolvedIssue {
  return {
    source: "github",
    key: "42",
    number: 42,
    title: "Test issue",
    body: "Issue body",
    branch: "feat/issue-42",
    ...overrides,
  };
}

/**
 * Test fixture factory for a Jira-sourced `ResolvedIssue`. Same shape as
 * `makeGitHubResolvedIssue` but with `source: "jira"`, a canonical Jira key,
 * and `number: 0` (Jira issues have no GH number).
 */
export function makeJiraResolvedIssue(overrides: Partial<ResolvedIssue> = {}): ResolvedIssue {
  return {
    source: "jira",
    key: "CUS-123",
    number: 0,
    title: "Jira issue",
    body: "Jira body",
    branch: "feat/CUS-123-jira",
    ...overrides,
  };
}
