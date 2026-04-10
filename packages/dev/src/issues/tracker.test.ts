import { mockExecFn, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

setupIsolatedHomeFixture("resolve-issue");

const ghIssueResponse = JSON.stringify({ number: 42, title: "GH issue", body: "GH body" });

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

async function importTrackerWithJiraResult(result: unknown) {
  vi.doMock("@callumvass/forgeflow-shared/atlassian", () => ({
    fetchJiraIssueViaOauth: vi.fn(async () => result),
  }));
  return import("./index.js");
}

describe("resolveIssue", () => {
  it("uses execSafeFn for `gh issue view` and returns a GitHub-shaped ResolvedIssue", async () => {
    const { resolveIssue } = await import("./index.js");
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse });
    const execFn = mockExecFn();

    const result = await resolveIssue("/tmp", "42", { execFn, execSafeFn });

    expect(execSafeFn).toHaveBeenCalledWith(expect.stringContaining("gh issue view 42"), "/tmp");
    expect(result).toEqual({
      source: "github",
      key: "42",
      number: 42,
      title: "GH issue",
      body: "GH body",
      branch: "feat/issue-42",
    });
  });

  it("resolves Jira issues through Atlassian MCP", async () => {
    const { resolveIssue } = await importTrackerWithJiraResult({
      key: "CUS-123",
      title: "MCP Jira issue",
      body: "Body via MCP",
    });

    const result = await resolveIssue("/tmp", "CUS-123", { execFn: mockExecFn(), execSafeFn: mockExecFn() });

    expect(result).toEqual({
      source: "jira",
      key: "CUS-123",
      number: 0,
      title: "MCP Jira issue",
      body: "Body via MCP",
      branch: "feat/CUS-123-mcp-jira-issue",
    });
  });

  it("detects Jira feature branches and preserves the existing branch name", async () => {
    const { resolveIssue } = await importTrackerWithJiraResult({
      key: "CUS-9",
      title: "Foo bar",
      body: "",
    });

    const result = await resolveIssue("/tmp", undefined, {
      execFn: mockExecFn({ "git branch --show-current": "feat/CUS-9-foo" }),
      execSafeFn: mockExecFn(),
    });

    if (typeof result === "string") throw new Error("expected ResolvedIssue, got error string");
    expect(result.source).toBe("jira");
    expect(result.key).toBe("CUS-9");
    expect(result.branch).toBe("feat/CUS-9-foo");
  });

  it("with no arg, detects GitHub feature branches via `git branch --show-current`", async () => {
    const { resolveIssue } = await import("./index.js");
    const execFn = mockExecFn({ "git branch --show-current": "feat/issue-7" });
    const execSafeFn = mockExecFn({ "gh issue view": JSON.stringify({ number: 7, title: "Auto", body: "B" }) });

    const result = await resolveIssue("/tmp", undefined, { execFn, execSafeFn });

    expect(execFn).toHaveBeenCalledWith("git branch --show-current", "/tmp");
    expect(result).toMatchObject({ source: "github", number: 7, branch: "feat/issue-7" });
  });

  it("returns a free-text ResolvedIssue without invoking exec when given a description", async () => {
    const { resolveIssue } = await import("./index.js");
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

  it("returns an error string for malformed GitHub issue JSON", async () => {
    const { resolveIssue } = await import("./index.js");
    const result = await resolveIssue("/tmp", "42", {
      execFn: mockExecFn(),
      execSafeFn: mockExecFn({ "gh issue view": "{ not json" }),
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("Could not parse issue #42");
  });

  it("returns an error string when the current branch is unrecognised", async () => {
    const { resolveIssue } = await import("./index.js");
    const result = await resolveIssue("/tmp", undefined, {
      execFn: mockExecFn({ "git branch --show-current": "main" }),
      execSafeFn: mockExecFn(),
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("main");
  });
});
