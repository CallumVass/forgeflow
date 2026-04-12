import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import { getDatadogMcpConfig, loginWithDatadogMcpOauth } from "./oauth.js";

const _fixture = setupIsolatedHomeFixture("datadog-mcp-oauth");

describe("getDatadogMcpConfig", () => {
  it("uses sensible defaults", () => {
    const config = getDatadogMcpConfig({
      DATADOG_MCP_URL: "https://example.com/mcp",
    });

    expect(config).toEqual({
      serverUrl: "https://example.com/mcp",
      redirectUri: "http://127.0.0.1:33390/callback",
      clientName: "Forgeflow Datadog MCP",
      scope: undefined,
      clientId: undefined,
      clientSecret: undefined,
      clientMetadataUrl: undefined,
    });
  });

  it("requires DATADOG_MCP_URL", () => {
    expect(getDatadogMcpConfig({})).toContain("Missing DATADOG_MCP_URL");
  });
});

describe("loginWithDatadogMcpOauth", () => {
  it("reconnects with a fresh transport after OAuth completes", async () => {
    process.env.DATADOG_MCP_URL = "https://example.com/mcp";

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

    const result = await loginWithDatadogMcpOauth(
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
          listTools: async () => ({ tools: [{ name: "query-metrics" }, { name: "search-logs" }] }),
        }),
      },
    );

    expect(result).toEqual({
      serverUrl: "https://example.com/mcp",
      toolNames: ["query-metrics", "search-logs"],
    });
    expect(connectCalls).toBe(2);
    expect(finishAuth).toHaveBeenCalledWith("oauth-code");
    expect(closeFns[0]).toHaveBeenCalled();
    expect(closeFns[1]).toHaveBeenCalled();
  });
});
