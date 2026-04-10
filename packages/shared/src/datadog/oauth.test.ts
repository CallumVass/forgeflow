import * as fs from "node:fs/promises";
import * as path from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import {
  clearDatadogMcpOauthState,
  getDatadogMcpConfig,
  getDatadogMcpOauthStatePath,
  loginWithDatadogMcpOauth,
  readDatadogMcpOauthState,
  writeDatadogMcpOauthState,
} from "./oauth.js";

const fixture = setupIsolatedHomeFixture("datadog-mcp-oauth");

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

describe("Datadog MCP OAuth state", () => {
  it("writes and clears the stored OAuth state under ~/.pi/agent", async () => {
    await writeDatadogMcpOauthState({
      codeVerifier: "verifier",
      clientInformation: { client_id: "client-id" },
      tokens: { access_token: "token", token_type: "Bearer", refresh_token: "refresh" },
    });

    const state = await readDatadogMcpOauthState();
    expect(state).toMatchObject({
      codeVerifier: "verifier",
      clientInformation: { client_id: "client-id" },
      tokens: { access_token: "token", token_type: "Bearer", refresh_token: "refresh" },
    });

    expect(getDatadogMcpOauthStatePath().startsWith(fixture.homeDir)).toBe(true);
    await clearDatadogMcpOauthState();
    await expect(
      fs.access(path.join(fixture.homeDir, ".pi", "agent", "forgeflow-datadog-mcp-oauth.json")),
    ).rejects.toBeTruthy();
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
