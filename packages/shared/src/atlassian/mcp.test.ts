import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import { getAtlassianMcpConfig, loginWithAtlassianMcpOauth } from "./mcp.js";

const _fixture = setupIsolatedHomeFixture("atlassian-mcp-oauth");

describe("getAtlassianMcpConfig", () => {
  it("uses sensible defaults and keeps ATLASSIAN_URL as a site hint", () => {
    const config = getAtlassianMcpConfig({
      ATLASSIAN_MCP_URL: "https://example.com/mcp",
      ATLASSIAN_URL: "https://example.atlassian.net",
    });

    expect(config).toEqual({
      serverUrl: "https://example.com/mcp",
      redirectUri: "http://127.0.0.1:33389/callback",
      clientName: "Forgeflow Atlassian MCP",
      scope: undefined,
      clientId: undefined,
      clientSecret: undefined,
      clientMetadataUrl: undefined,
      siteUrl: "https://example.atlassian.net",
    });
  });

  it("requires ATLASSIAN_MCP_URL", () => {
    expect(getAtlassianMcpConfig({})).toContain("Missing ATLASSIAN_MCP_URL");
  });
});

describe("loginWithAtlassianMcpOauth", () => {
  it("reconnects with a fresh transport after OAuth completes", async () => {
    process.env.ATLASSIAN_MCP_URL = "https://example.com/mcp";

    const closeFns = [vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)];
    const finishAuth = vi.fn().mockResolvedValue(undefined);
    const transports = [
      {
        start: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        finishAuth,
        close: closeFns[0],
      },
      {
        start: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        finishAuth: vi.fn().mockResolvedValue(undefined),
        close: closeFns[1],
      },
    ];
    let transportIndex = 0;
    let connectCalls = 0;

    const result = await loginWithAtlassianMcpOauth(
      {},
      {
        waitForOauthCallbackFn: async () => "oauth-code",
        createTransportFn: () => {
          const transport = transports[transportIndex++];
          if (!transport) throw new Error("expected a transport stub");
          return transport;
        },
        createClientFn: () => ({
          connect: async () => {
            connectCalls += 1;
            if (connectCalls === 1) throw new UnauthorizedError();
          },
          listTools: async () => ({ tools: [{ name: "get-jira-issue" }, { name: "get-confluence-page" }] }),
        }),
      },
    );

    expect(result).toEqual({
      serverUrl: "https://example.com/mcp",
      toolNames: ["get-confluence-page", "get-jira-issue"],
    });
    expect(connectCalls).toBe(2);
    expect(finishAuth).toHaveBeenCalledWith("oauth-code");
    expect(closeFns[0]).toHaveBeenCalled();
    expect(closeFns[1]).toHaveBeenCalled();
  });
});
