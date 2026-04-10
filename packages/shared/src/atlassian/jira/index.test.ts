import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJiraIssueViaOauth, fetchJiraIssueFromUrl, fetchJiraIssueViaOauth } from "./index.js";

function mcpText(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

describe("fetchJiraIssueViaOauth", () => {
  beforeEach(() => {
    process.env.ATLASSIAN_MCP_URL = "https://example.com/mcp";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
  });

  afterEach(() => {
    delete process.env.ATLASSIAN_MCP_URL;
    delete process.env.ATLASSIAN_URL;
  });

  it("returns the current normalised JiraIssue shape", async () => {
    const session = {
      toolNames: ["get-jira-issue"],
      tools: [{ name: "get-jira-issue", description: "Read a Jira issue" }],
    };
    const callMcpToolFn = vi.fn(async () =>
      mcpText({
        key: "PROJ-7",
        fields: {
          summary: "MCP Jira issue",
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: "Hello Jira" }] }],
          },
          status: { name: "Open" },
          priority: { name: "High" },
          issuetype: { name: "Task" },
          customfield_10001: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: "Must do X" }] }],
          },
          customfield_10002: 5,
          customfield_10003: "Sprint 9",
        },
        names: {
          customfield_10001: "Acceptance Criteria",
          customfield_10002: "Story Points",
          customfield_10003: "Sprint",
        },
      }),
    );

    const result = await fetchJiraIssueViaOauth("PROJ-7", {
      withMcpSessionFn: async (fn) => fn(session as never),
      callMcpToolFn,
    });

    expect(result).toEqual({
      key: "PROJ-7",
      title: "MCP Jira issue",
      issueType: "Task",
      body: [
        "Hello Jira",
        "## Acceptance Criteria\nMust do X",
        "**Status:** Open",
        "**Priority:** High",
        "**Story Points:** 5",
        "**Sprint:** Sprint 9",
      ].join("\n\n"),
    });
  });

  it("extracts a Jira key from a browse URL before reading the issue", async () => {
    const session = {
      toolNames: ["get-jira-issue"],
      tools: [{ name: "get-jira-issue", description: "Read a Jira issue" }],
    };
    const callMcpToolFn = vi.fn(async (_session, _toolName, args) => {
      expect(args).toEqual({ issueKey: "PROJ-7" });
      return mcpText({ key: "PROJ-7", title: "URL Jira issue", body: "Hello Jira", issueType: "Task" });
    });

    const result = await fetchJiraIssueFromUrl("https://example.atlassian.net/browse/PROJ-7", {
      withMcpSessionFn: async (fn) => fn(session as never),
      callMcpToolFn,
    });

    expect(result).toEqual({ key: "PROJ-7", title: "URL Jira issue", body: "Hello Jira", issueType: "Task" });
  });

  it("supports cloudId-based and non-cloudId Jira issue creation tool signatures", async () => {
    const session = {
      toolNames: ["getAccessibleAtlassianResources", "createJiraIssue"],
      tools: [
        { name: "getAccessibleAtlassianResources", description: "List accessible Atlassian resources" },
        { name: "createJiraIssue", description: "Create a Jira issue" },
      ],
    };
    const callMcpToolFn = vi.fn(async (_session, toolName, args) => {
      if (toolName === "getAccessibleAtlassianResources") {
        return mcpText([
          {
            id: "cloud-jira",
            url: "https://example.atlassian.net",
            name: "Example Jira",
            scopes: ["read:jira-work", "write:jira-work"],
          },
        ]);
      }
      if (toolName === "createJiraIssue") {
        expect(args).toEqual({
          cloudId: "cloud-jira",
          projectKey: "PROJ",
          summary: "Add dashboard filters",
          description: "## Description\nUsers can filter the dashboard.",
          issueType: "Story",
        });
        return mcpText({ id: "10001", key: "PROJ-101" });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const result = await createJiraIssueViaOauth(
      {
        projectKey: "PROJ",
        summary: "Add dashboard filters",
        description: "## Description\nUsers can filter the dashboard.",
      },
      {
        withMcpSessionFn: async (fn) => fn(session as never),
        callMcpToolFn,
        siteUrl: "https://example.atlassian.net",
      },
    );

    expect(result).toEqual({
      id: "10001",
      key: "PROJ-101",
      url: "https://example.atlassian.net/browse/PROJ-101",
    });
  });
});
