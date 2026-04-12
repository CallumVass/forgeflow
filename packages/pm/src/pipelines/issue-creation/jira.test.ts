import { mockPipelineContext, mockRunAgent, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = setupIsolatedHomeFixture("jira-pipeline");

function extractJiraKey(input: string) {
  const match = input.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
  return match?.[0] ?? null;
}

function mockConfluenceModule(fetchConfluencePageViaOauth: (url: string) => Promise<unknown>) {
  vi.doMock("@callumvass/forgeflow-shared/atlassian/confluence", () => ({
    fetchConfluencePageViaOauth,
  }));
}

function mockJiraModule(options: {
  createJiraIssueViaOauth: ReturnType<typeof vi.fn>;
  fetchJiraIssueFromUrl?: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("@callumvass/forgeflow-shared/atlassian/jira", () => ({
    createJiraIssueViaOauth: options.createJiraIssueViaOauth,
    extractJiraKey,
    extractProjectKey: (issueKey: string) => issueKey.split("-")[0] ?? issueKey,
    fetchJiraIssueFromUrl: options.fetchJiraIssueFromUrl ?? vi.fn(),
    getJiraCreationDefaults: () => ({ projectKey: "PROJ", issueType: "Story" }),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  expect(fixture.homeDir).toBeTruthy();
});

describe("runJiraIssues", () => {
  it("plans Jira issue drafts then publishes them via Atlassian MCP", async () => {
    const fetchConfluencePageViaOauth = vi.fn(async () => ({
      id: "999",
      title: "Product requirements",
      body: "Users need dashboard filtering and saved views.",
    }));
    mockConfluenceModule(fetchConfluencePageViaOauth);

    const createJiraIssueViaOauth = vi
      .fn()
      .mockResolvedValueOnce({ id: "10001", key: "PROJ-101", url: "https://example.atlassian.net/browse/PROJ-101" })
      .mockResolvedValueOnce({ id: "10002", key: "PROJ-102", url: "https://example.atlassian.net/browse/PROJ-102" });

    mockJiraModule({
      createJiraIssueViaOauth,
      fetchJiraIssueFromUrl: vi.fn(async () => ({
        key: "PROJ-1",
        title: "Example",
        body: "Example body",
        issueType: "Story",
      })),
    });

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
    expect(fetchConfluencePageViaOauth).toHaveBeenCalledWith(
      "https://example.atlassian.net/wiki/spaces/PM/pages/999/Product-Requirements",
    );
    expect(runAgentFn).toHaveBeenCalledWith("jira-issue-planner", expect.any(String), expect.any(Object));
    expect(createJiraIssueViaOauth).toHaveBeenCalledTimes(2);
  });

  it("fetches a Confluence example URL through the Atlassian boundary and includes it in the planner prompt", async () => {
    const fetchConfluencePageViaOauth = vi.fn(async (url: string) => {
      if (url.includes("/pages/999/")) {
        return {
          id: "999",
          title: "Product requirements",
          body: "Users need dashboard filtering and saved views.",
        };
      }
      if (url.includes("/pages/123/")) {
        return {
          id: "123",
          title: "Story template",
          body: "## Acceptance Criteria\n- Example body",
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    mockConfluenceModule(fetchConfluencePageViaOauth);

    const createJiraIssueViaOauth = vi
      .fn()
      .mockResolvedValueOnce({ id: "10001", key: "PROJ-101", url: "https://example.atlassian.net/browse/PROJ-101" });

    mockJiraModule({ createJiraIssueViaOauth });

    const { runJiraIssues } = await import("./jira.js");
    const runAgentFn = mockRunAgent('```json\n[{"summary":"Add dashboard filters","description":"From example"}]\n```');
    const pctx = mockPipelineContext({ cwd: fixture.cwdDir, runAgentFn });

    const result = await runJiraIssues(
      ["https://example.atlassian.net/wiki/spaces/PM/pages/999/Product-Requirements"],
      "https://example.atlassian.net/wiki/spaces/PM/pages/123/Story-Template",
      pctx,
    );

    expect(result.isError).toBeUndefined();
    expect(fetchConfluencePageViaOauth).toHaveBeenNthCalledWith(
      1,
      "https://example.atlassian.net/wiki/spaces/PM/pages/999/Product-Requirements",
    );
    expect(fetchConfluencePageViaOauth).toHaveBeenNthCalledWith(
      2,
      "https://example.atlassian.net/wiki/spaces/PM/pages/123/Story-Template",
    );
    const prompt = String(runAgentFn.mock.calls[0]?.[1] ?? "");
    expect(prompt).toContain("EXAMPLE TICKET (match this format):\nTitle: Story template");
    expect(prompt).toContain("## Acceptance Criteria\n- Example body");
  });
});
