import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { resolveIssue } from "./git.js";

const ghIssueResponse = JSON.stringify({ number: 42, title: "GH issue", body: "GH body" });
const jiraIssueResponse = JSON.stringify({
  fields: { summary: "Jira issue", description: "Jira body", status: { name: "Open" } },
});

describe("resolveIssue", () => {
  it("uses the injected execSafe spy for `gh issue view` when given a numeric arg", async () => {
    const execSafe = mockExecFn({ "gh issue view": ghIssueResponse, "gh pr list": "" });
    const exec = mockExecFn();

    const result = await resolveIssue("/tmp", "42", { exec, execSafe });

    expect(execSafe).toHaveBeenCalledWith(expect.stringContaining("gh issue view 42"), "/tmp");
    expect(result).toMatchObject({ source: "github", number: 42, title: "GH issue", branch: "feat/issue-42" });
  });

  it("uses the injected execSafe spy for `jira issue view` when given a Jira key", async () => {
    const execSafe = mockExecFn({ "jira issue view": jiraIssueResponse, "gh pr list": "" });
    const exec = mockExecFn();

    const result = await resolveIssue("/tmp", "PROJ-123", { exec, execSafe });

    expect(execSafe).toHaveBeenCalledWith(expect.stringContaining("jira issue view PROJ-123"), "/tmp");
    expect(result).toMatchObject({ source: "jira", key: "PROJ-123", title: "Jira issue" });
  });

  it("uses the injected exec spy for `git branch --show-current` when no arg is provided", async () => {
    const exec = mockExecFn({ "git branch --show-current": "feat/issue-7" });
    const execSafe = mockExecFn({ "gh issue view": JSON.stringify({ number: 7, title: "Auto", body: "B" }) });

    const result = await resolveIssue("/tmp", undefined, { exec, execSafe });

    expect(exec).toHaveBeenCalledWith("git branch --show-current", "/tmp");
    expect(result).toMatchObject({ source: "github", number: 7, branch: "feat/issue-7" });
  });

  it("returns an explanatory string when current branch yields no detectable issue", async () => {
    const exec = mockExecFn({ "git branch --show-current": "main" });
    const execSafe = mockExecFn();

    const result = await resolveIssue("/tmp", undefined, { exec, execSafe });

    expect(typeof result).toBe("string");
    expect(result as string).toContain("main");
  });

  it("returns a free-text resolved issue without invoking exec when given a description", async () => {
    const exec = mockExecFn();
    const execSafe = mockExecFn();

    const result = await resolveIssue("/tmp", "Add user signup", { exec, execSafe });

    expect(result).toMatchObject({ source: "github", number: 0, title: "Add user signup" });
    expect(exec).not.toHaveBeenCalled();
    expect(execSafe).not.toHaveBeenCalled();
  });
});
