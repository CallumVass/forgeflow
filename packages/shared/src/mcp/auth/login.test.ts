import { describe, expect, it } from "vitest";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { getMcpAuthStatus } from "./login.js";
import { getMcpOauthStatePath, writeMcpOauthState } from "./state.js";

const fixture = setupIsolatedHomeFixture("mcp-auth-login");

describe("getMcpAuthStatus", () => {
  it("reports authentication and refresh-token state from stored tokens", async () => {
    const statePath = getMcpOauthStatePath("status-test");
    await writeMcpOauthState(statePath, {
      tokens: { access_token: "token", token_type: "Bearer", refresh_token: "refresh" },
    });

    await expect(
      getMcpAuthStatus(
        {
          serverUrl: "https://example.com/mcp",
          redirectUri: "http://127.0.0.1:33389/callback",
          clientName: "Test MCP",
        },
        statePath,
      ),
    ).resolves.toEqual({
      configured: true,
      authenticated: true,
      serverUrl: "https://example.com/mcp",
      hasRefreshToken: true,
      tokenType: "Bearer",
    });

    expect(fixture.homeDir).toContain("mcp-auth-login");
  });
});
