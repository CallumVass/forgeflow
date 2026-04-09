import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import {
  clearDatadogMcpOauthState,
  getDatadogMcpConfig,
  getDatadogMcpOauthStatePath,
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
