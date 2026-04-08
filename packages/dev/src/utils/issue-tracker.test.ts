import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { resolveIssue } from "./issue-tracker.js";

const ghIssueResponse = JSON.stringify({ number: 42, title: "GH issue", body: "GH body" });
const jiraIssueResponse = JSON.stringify({
  fields: {
    summary: "Jira issue",
    description: "Jira body",
    acceptance_criteria: "AC body",
    status: { name: "Open" },
    priority: { name: "High" },
    story_points: 5,
    sprint: { name: "Sprint 1" },
  },
});

describe("resolveIssue", () => {
  it("uses execSafeFn for `gh issue view` and returns a GitHub-shaped ResolvedIssue with the exact 6-key shape", async () => {
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse });
    const execFn = mockExecFn();

    const result = await resolveIssue("/tmp", "42", { execFn, execSafeFn });

    expect(execSafeFn).toHaveBeenCalledWith(expect.stringContaining("gh issue view 42"), "/tmp");
    // Exact-equality lock the shape: { source, key, number, title, body, branch }.
    expect(result).toEqual({
      source: "github",
      key: "42",
      number: 42,
      title: "GH issue",
      body: "GH body",
      branch: "feat/issue-42",
    });
    // resolveIssue must NOT inspect PR state — that is now the caller's job.
    const calls = (execFn.mock.calls as Array<[string, ...unknown[]]>).map((c) => c[0]);
    expect(calls.some((c) => c.includes("gh pr list"))).toBe(false);
  });

  it("returns a Jira-shaped ResolvedIssue with body assembled from description, AC, status, priority, story_points and sprint", async () => {
    const execSafeFn = mockExecFn({ "jira issue view": jiraIssueResponse });
    const execFn = mockExecFn();

    const result = await resolveIssue("/tmp", "CUS-123", { execFn, execSafeFn });

    expect(execSafeFn).toHaveBeenCalledWith(expect.stringContaining("jira issue view CUS-123"), "/tmp");
    if (typeof result === "string") throw new Error("expected ResolvedIssue, got error string");
    expect(result.source).toBe("jira");
    expect(result.key).toBe("CUS-123");
    expect(result.number).toBe(0);
    expect(result.title).toBe("Jira issue");
    expect(result.branch).toBe("feat/CUS-123-jira-issue");
    expect(result.body).toContain("Jira body");
    expect(result.body).toContain("## Acceptance Criteria\nAC body");
    expect(result.body).toContain("**Status:** Open");
    expect(result.body).toContain("**Priority:** High");
    expect(result.body).toContain("**Story Points:** 5");
    expect(result.body).toContain("**Sprint:** Sprint 1");
    // Exact-equality lock the shape — only the 6 documented keys.
    expect(Object.keys(result).sort()).toEqual(["body", "branch", "key", "number", "source", "title"]);
  });

  it("with no arg, detects GitHub feature branches via `git branch --show-current`", async () => {
    const execFn = mockExecFn({ "git branch --show-current": "feat/issue-7" });
    const execSafeFn = mockExecFn({ "gh issue view": JSON.stringify({ number: 7, title: "Auto", body: "B" }) });

    const result = await resolveIssue("/tmp", undefined, { execFn, execSafeFn });

    expect(execFn).toHaveBeenCalledWith("git branch --show-current", "/tmp");
    expect(result).toMatchObject({ source: "github", number: 7, branch: "feat/issue-7" });
  });

  it("with no arg, detects Jira feature branches and preserves the existing branch name", async () => {
    const execFn = mockExecFn({ "git branch --show-current": "feat/CUS-9-foo" });
    const execSafeFn = mockExecFn({
      "jira issue view": JSON.stringify({ fields: { summary: "Foo bar" } }),
    });

    const result = await resolveIssue("/tmp", undefined, { execFn, execSafeFn });

    if (typeof result === "string") throw new Error("expected ResolvedIssue, got error string");
    expect(result.source).toBe("jira");
    expect(result.key).toBe("CUS-9");
    // Branch is preserved verbatim from `git branch --show-current`, not re-slugified.
    expect(result.branch).toBe("feat/CUS-9-foo");
  });

  it("returns a free-text ResolvedIssue without invoking exec when given a description", async () => {
    const execFn = mockExecFn();
    const execSafeFn = mockExecFn();

    const result = await resolveIssue("/tmp", "Add user signup", { execFn, execSafeFn });

    expect(result).toEqual({
      source: "github",
      key: "",
      number: 0,
      title: "Add user signup",
      body: "Add user signup",
      branch: "",
    });
    expect(execFn).not.toHaveBeenCalled();
    expect(execSafeFn).not.toHaveBeenCalled();
  });

  const errorCases: Array<{
    label: string;
    execResponses: Record<string, string>;
    safeResponses: Record<string, string>;
    arg: string | undefined;
    contains: string;
  }> = [
    {
      label: "unrecognised current branch",
      execResponses: { "git branch --show-current": "main" },
      safeResponses: {},
      arg: undefined,
      contains: "main",
    },
    {
      label: "empty `gh issue view` output",
      execResponses: {},
      safeResponses: { "gh issue view": "" },
      arg: "42",
      contains: "Could not fetch issue #42",
    },
    {
      label: "malformed `gh issue view` JSON",
      execResponses: {},
      safeResponses: { "gh issue view": "{ not json" },
      arg: "42",
      contains: "Could not parse issue #42",
    },
    {
      label: "malformed `jira issue view` JSON",
      execResponses: {},
      safeResponses: { "jira issue view": "{ not json" },
      arg: "PROJ-1",
      contains: "Could not parse Jira issue PROJ-1",
    },
  ];

  it.each(errorCases)("returns an error string when $label", async ({
    execResponses,
    safeResponses,
    arg,
    contains,
  }) => {
    const execFn = mockExecFn(execResponses);
    const execSafeFn = mockExecFn(safeResponses);

    const result = await resolveIssue("/tmp", arg, { execFn, execSafeFn });

    expect(typeof result).toBe("string");
    expect(result as string).toContain(contains);
  });
});
