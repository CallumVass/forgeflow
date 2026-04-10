import { mockPipelineContext, mockRunAgent, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = setupIsolatedHomeFixture("jira-pipeline");

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  expect(fixture.homeDir).toBeTruthy();
});

describe("runJiraIssues", () => {
  it("plans Jira issue drafts then publishes them via Atlassian MCP", async () => {
    vi.doMock("@callumvass/forgeflow-shared/confluence", () => ({
      fetchConfluencePage: vi.fn(async () => ({
        id: "999",
        title: "Product requirements",
        body: "Users need dashboard filtering and saved views.",
      })),
    }));

    const createJiraIssueViaOauth = vi
      .fn()
      .mockResolvedValueOnce({ id: "10001", key: "PROJ-101", url: "https://example.atlassian.net/browse/PROJ-101" })
      .mockResolvedValueOnce({ id: "10002", key: "PROJ-102", url: "https://example.atlassian.net/browse/PROJ-102" });

    vi.doMock("@callumvass/forgeflow-shared/atlassian", () => ({
      createJiraIssueViaOauth,
      extractJiraKey: (input: string) => {
        const match = input.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
        return match?.[0] ?? null;
      },
      extractProjectKey: (issueKey: string) => issueKey.split("-")[0] ?? issueKey,
      fetchJiraIssueFromUrl: vi.fn(async () => ({
        key: "PROJ-1",
        title: "Example",
        body: "Example body",
        issueType: "Story",
      })),
      getJiraCreationDefaults: () => ({ projectKey: "PROJ", issueType: "Story" }),
    }));

    const { runJiraIssues } = await import("./jira.js");
    const plannerOutput = [
      "```json",
      "[",
      '  { "summary": "Add dashboard filters", "description": "## Description\\nUsers can filter the dashboard." },',
      '  { "summary": "Ship saved views", "description": "## Description\\nUsers can save filtered views.", "issueType": "Task" }',
      "]",
      "```",
    ].join("\n");

    const runAgentFn = mockRunAgent(plannerOutput);
    const pctx = mockPipelineContext({ cwd: fixture.cwdDir, runAgentFn });

    const result = await runJiraIssues(
      ["https://example.atlassian.net/wiki/spaces/PM/pages/999/Product-Requirements"],
      "",
      pctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("PROJ-101, PROJ-102");
    expect(runAgentFn).toHaveBeenCalledWith("jira-issue-planner", expect.any(String), expect.any(Object));
    expect(createJiraIssueViaOauth).toHaveBeenCalledTimes(2);
  });
});
