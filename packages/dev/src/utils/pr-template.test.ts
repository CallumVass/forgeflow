import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGitHubResolvedIssue, makeJiraResolvedIssue } from "./issue-tracker.fixtures.js";
import { buildPrBody } from "./pr-template.js";

const githubIssue = makeGitHubResolvedIssue({ title: "GH", body: "GH body" });
const jiraIssue = makeJiraResolvedIssue({ title: "Jira", body: "Jira body", branch: "feat/CUS-123-jira" });

describe("buildPrBody", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-pr-template-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 'Closes #N' for a GitHub issue when no PR template exists", () => {
    expect(buildPrBody(tmpDir, githubIssue)).toBe("Closes #42");
  });

  it("returns 'Closes #N' followed by template contents when a GitHub PR template is found", () => {
    fs.mkdirSync(path.join(tmpDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".github", "pull_request_template.md"), "## Summary\n- foo");
    expect(buildPrBody(tmpDir, githubIssue)).toBe("Closes #42\n\n## Summary\n- foo");
  });

  it("returns 'Jira: KEY' for a Jira issue when no template exists, and 'Jira: KEY\\n\\n<template>' when one is found", () => {
    expect(buildPrBody(tmpDir, jiraIssue)).toBe("Jira: CUS-123");

    fs.mkdirSync(path.join(tmpDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".github", "PULL_REQUEST_TEMPLATE.md"), "TEMPLATE");
    expect(buildPrBody(tmpDir, jiraIssue)).toBe("Jira: CUS-123\n\nTEMPLATE");
  });
});
