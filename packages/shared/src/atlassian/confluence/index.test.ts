import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchConfluencePageViaOauth } from "./index.js";

function mcpText(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

describe("fetchConfluencePageViaOauth", () => {
  beforeEach(() => {
    process.env.ATLASSIAN_MCP_URL = "https://example.com/mcp";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
  });

  afterEach(() => {
    delete process.env.ATLASSIAN_MCP_URL;
    delete process.env.ATLASSIAN_URL;
  });

  it("resolves a Confluence page URL and normalises storage HTML into plain text", async () => {
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

  it("accepts plain-body responses from cloudId-based Confluence tools", async () => {
    const session = {
      toolNames: ["getAccessibleAtlassianResources", "getConfluencePage"],
      tools: [
        { name: "getAccessibleAtlassianResources", description: "List accessible Atlassian resources" },
        { name: "getConfluencePage", description: "Read a Confluence page" },
      ],
    };
    const callMcpToolFn = vi.fn(async (_session, toolName, args) => {
      if (toolName === "getAccessibleAtlassianResources") {
        return mcpText([
          {
            id: "cloud-confluence",
            url: "https://example.atlassian.net",
            name: "Example Confluence",
            scopes: ["read:confluence-content.all", "read:page:confluence"],
          },
        ]);
      }
      if (toolName === "getConfluencePage") {
        expect(args).toEqual({ cloudId: "cloud-confluence", pageId: "999" });
        return mcpText({ id: "999", title: "Cloud Page", body: "Hello Confluence" });
      }
      throw new Error(`Unexpected tool ${toolName}`);
    });

    const result = await fetchConfluencePageViaOauth("https://example.atlassian.net/wiki/spaces/X/pages/999/Page", {
      withMcpSessionFn: async (fn) => fn(session as never),
      callMcpToolFn,
      siteUrl: "https://example.atlassian.net",
    });

    expect(result).toEqual({ id: "999", title: "Cloud Page", body: "Hello Confluence" });
  });
});
