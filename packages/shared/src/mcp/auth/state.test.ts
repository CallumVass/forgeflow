import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { clearMcpOauthState, getMcpOauthStatePath, readMcpOauthState, writeMcpOauthState } from "./state.js";

const fixture = setupIsolatedHomeFixture("mcp-auth-state");

describe("MCP OAuth state", () => {
  it("round-trips state on disk and clears missing files cleanly", async () => {
    const statePath = getMcpOauthStatePath("test");

    await writeMcpOauthState(statePath, {
      codeVerifier: "verifier",
      clientInformation: { client_id: "client-id" },
      tokens: { access_token: "token", token_type: "Bearer", refresh_token: "refresh" },
    });

    expect(statePath.startsWith(fixture.homeDir)).toBe(true);
    expect(await readMcpOauthState(statePath)).toMatchObject({
      codeVerifier: "verifier",
      clientInformation: { client_id: "client-id" },
      tokens: { access_token: "token", token_type: "Bearer", refresh_token: "refresh" },
    });

    await clearMcpOauthState(statePath);
    await clearMcpOauthState(statePath);
    await expect(
      fs.access(path.join(fixture.homeDir, ".pi", "agent", "forgeflow-test-mcp-oauth.json")),
    ).rejects.toBeTruthy();
  });
});
