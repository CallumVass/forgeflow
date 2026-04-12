import { describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { StoredMcpOAuthProvider } from "./provider.js";
import { readMcpOauthState } from "./state.js";

const fixture = setupIsolatedHomeFixture("mcp-auth-provider");

describe("StoredMcpOAuthProvider", () => {
  it("invalidates only the requested credential scope and persists the retained state", async () => {
    const statePath = `${fixture.homeDir}/provider-state.json`;
    const provider = new StoredMcpOAuthProvider(
      {
        serverUrl: "https://example.com/mcp",
        redirectUri: "http://127.0.0.1:33389/callback",
        clientName: "Test MCP",
      },
      statePath,
      {
        clientInformation: { client_id: "client-id" },
        tokens: { access_token: "token", token_type: "Bearer", refresh_token: "refresh" },
        codeVerifier: "verifier",
        discoveryState: { authorizationServerUrl: "https://example.com" } as never,
      },
      vi.fn(),
    );

    await provider.invalidateCredentials("tokens");

    expect(await readMcpOauthState(statePath)).toMatchObject({
      clientInformation: { client_id: "client-id" },
      codeVerifier: "verifier",
      discoveryState: { authorizationServerUrl: "https://example.com" },
    });
    expect((await readMcpOauthState(statePath))?.tokens).toBeUndefined();
  });
});
