import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJiraIssueViaOauth,
  fetchAtlassianContentFromUrl,
  fetchConfluencePageViaOauth,
  fetchJiraIssueViaOauth,
  formatAtlassianContent,
} from "./index.js";

function mcpText(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

describe("Atlassian MCP client", () => {
  beforeEach(() => {
    process.env.ATLASSIAN_MCP_URL = "https://example.com/mcp";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
  });

  afterEach(() => {
    delete process.env.ATLASSIAN_MCP_URL;
    delete process.env.ATLASSIAN_URL;
  });

  it("fetches a Confluence page through Atlassian MCP", async () => {
    const session = {
      toolNames: ["get-confluence-page"],
      tools: [{ name: "get-confluence-page", description: "Read a Confluence page" }],
    };
    const callMcpToolFn = vi.fn(async () =>
      mcpText({
        id: "999",
        title: "MCP Page",
        body: { storage: { value: "<p>Hello <strong>MCP</strong></p>" } },
      }),
    );

    const result = await fetchConfluencePageViaOauth("https://example.atlassian.net/wiki/spaces/X/pages/999/Page", {
      withMcpSessionFn: async (fn) => fn(session as never),
      callMcpToolFn,
    });

    expect(result).toEqual({ id: "999", title: "MCP Page", body: "Hello **MCP**" });
    expect(callMcpToolFn).toHaveBeenCalledWith(
      session,
      "get-confluence-page",
      expect.objectContaining({ url: "https://example.atlassian.net/wiki/spaces/X/pages/999/Page" }),
    );
  });

  it("fetches a Jira issue through Atlassian MCP and flattens ADF/custom fields", async () => {
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

  it("dispatches Atlassian URLs to Jira or Confluence readers and formats the result", async () => {
    const session = {
      toolNames: ["get-jira-issue", "get-confluence-page"],
      tools: [
        { name: "get-jira-issue", description: "Read a Jira issue" },
        { name: "get-confluence-page", description: "Read a Confluence page" },
      ],
    };
    const callMcpToolFn = vi.fn(async (_session, toolName) => {
      if (toolName === "get-jira-issue") {
        return mcpText({ key: "PROJ-7", title: "MCP Jira issue", body: "Hello Jira", issueType: "Task" });
      }
      return mcpText({ id: "999", title: "MCP Page", body: "Hello **MCP**" });
    });
    const deps = {
      withMcpSessionFn: async (fn: (session: unknown) => Promise<unknown>) => fn(session),
      callMcpToolFn,
    };

    const jira = await fetchAtlassianContentFromUrl("https://example.atlassian.net/browse/PROJ-7", deps);
    const confluence = await fetchAtlassianContentFromUrl(
      "https://example.atlassian.net/wiki/spaces/X/pages/999/Page",
      deps,
    );

    expect(jira).toEqual({
      kind: "jira",
      url: "https://example.atlassian.net/browse/PROJ-7",
      key: "PROJ-7",
      title: "MCP Jira issue",
      issueType: "Task",
      body: "Hello Jira",
    });
    expect(confluence).toEqual({
      kind: "confluence",
      url: "https://example.atlassian.net/wiki/spaces/X/pages/999/Page",
      id: "999",
      title: "MCP Page",
      body: "Hello **MCP**",
    });
    expect(formatAtlassianContent(jira as Exclude<typeof jira, string>)).toContain(
      "# Jira PROJ-7 (Task): MCP Jira issue",
    );
    expect(formatAtlassianContent(confluence as Exclude<typeof confluence, string>)).toContain(
      "# Confluence: MCP Page",
    );
  });

  it("creates Jira issues through Atlassian MCP", async () => {
    const session = {
      toolNames: ["create-jira-issue"],
      tools: [{ name: "create-jira-issue", description: "Create a Jira issue" }],
    };
    const callMcpToolFn = vi.fn(async () => mcpText({ id: "10001", key: "PROJ-101" }));

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
