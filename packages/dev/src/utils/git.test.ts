import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { resolveIssue } from "./git.js";

const ghIssueResponse = JSON.stringify({ number: 42, title: "GH issue", body: "GH body" });
const jiraIssueResponse = JSON.stringify({
  fields: { summary: "Jira issue", description: "Jira body", status: { name: "Open" } },
});

describe("resolveIssue", () => {
  it("uses the injected execSafeFn spy for `gh issue view` when given a numeric arg", async () => {
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse, "gh pr list": "" });
    const execFn = mockExecFn();

    const result = await resolveIssue("/tmp", "42", { execFn, execSafeFn });

    expect(execSafeFn).toHaveBeenCalledWith(expect.stringContaining("gh issue view 42"), "/tmp");
    expect(result).toMatchObject({ source: "github", number: 42, title: "GH issue", branch: "feat/issue-42" });
  });

  it("uses the injected execSafeFn spy for `jira issue view` when given a Jira key", async () => {
    const execSafeFn = mockExecFn({ "jira issue view": jiraIssueResponse, "gh pr list": "" });
    const execFn = mockExecFn();

    const result = await resolveIssue("/tmp", "PROJ-123", { execFn, execSafeFn });

    expect(execSafeFn).toHaveBeenCalledWith(expect.stringContaining("jira issue view PROJ-123"), "/tmp");
    expect(result).toMatchObject({ source: "jira", key: "PROJ-123", title: "Jira issue" });
  });

  it("uses the injected execFn spy for `git branch --show-current` when no arg is provided", async () => {
    const execFn = mockExecFn({ "git branch --show-current": "feat/issue-7" });
    const execSafeFn = mockExecFn({ "gh issue view": JSON.stringify({ number: 7, title: "Auto", body: "B" }) });

    const result = await resolveIssue("/tmp", undefined, { execFn, execSafeFn });

    expect(execFn).toHaveBeenCalledWith("git branch --show-current", "/tmp");
    expect(result).toMatchObject({ source: "github", number: 7, branch: "feat/issue-7" });
  });

  it("returns an explanatory string when current branch yields no detectable issue", async () => {
    const execFn = mockExecFn({ "git branch --show-current": "main" });
    const execSafeFn = mockExecFn();

    const result = await resolveIssue("/tmp", undefined, { execFn, execSafeFn });

    expect(typeof result).toBe("string");
    expect(result as string).toContain("main");
  });

  it("returns a free-text resolved issue without invoking exec when given a description", async () => {
    const execFn = mockExecFn();
    const execSafeFn = mockExecFn();

    const result = await resolveIssue("/tmp", "Add user signup", { execFn, execSafeFn });

    expect(result).toMatchObject({ source: "github", number: 0, title: "Add user signup" });
    expect(execFn).not.toHaveBeenCalled();
    expect(execSafeFn).not.toHaveBeenCalled();
  });
});
