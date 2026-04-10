import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAtlassianContentFromUrl, formatAtlassianContent } from "./index.js";

function mcpText(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

describe("Atlassian content", () => {
  beforeEach(() => {
    process.env.ATLASSIAN_MCP_URL = "https://example.com/mcp";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
  });

  afterEach(() => {
    delete process.env.ATLASSIAN_MCP_URL;
    delete process.env.ATLASSIAN_URL;
  });

  it("dispatches Jira and Confluence URLs and preserves the existing formatted output", async () => {
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
    expect(formatAtlassianContent(jira as Exclude<typeof jira, string>)).toContain(
      "Source: https://example.atlassian.net/browse/PROJ-7",
    );
  });
});
