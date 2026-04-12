import { describe, expect, it } from "vitest";
import { waitForOauthCallback } from "./callback-server.js";

describe("waitForOauthCallback", () => {
  it("returns the authorisation code and serves the success page", async () => {
    const redirectUri = "http://127.0.0.1:33401/callback";
    const waitForCode = waitForOauthCallback(redirectUri, "Test MCP", { timeoutMs: 1_000 });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const response = await fetch(`${redirectUri}?code=oauth-code`);

    expect(response.status).toBe(200);
    await expect(waitForCode).resolves.toBe("oauth-code");
    await expect(response.text()).resolves.toContain("Forgeflow connected to Test MCP.");
  });

  it("rejects missing-code, OAuth-error, and timeout flows with service-labelled guidance", async () => {
    const missingCodeUri = "http://127.0.0.1:33402/callback";
    const missingCode = waitForOauthCallback(missingCodeUri, "Test MCP", { timeoutMs: 1_000 });
    const missingCodeAssertion = expect(missingCode).rejects.toThrow("Test MCP OAuth callback did not include a code.");
    await new Promise((resolve) => setTimeout(resolve, 25));
    const missingCodeResponse = await fetch(missingCodeUri);
    expect(missingCodeResponse.status).toBe(400);
    await expect(missingCodeResponse.text()).resolves.toContain("did not include a code");
    await missingCodeAssertion;

    const erroredUri = "http://127.0.0.1:33403/callback";
    const errored = waitForOauthCallback(erroredUri, "Test MCP", { timeoutMs: 1_000 });
    const erroredAssertion = expect(errored).rejects.toThrow("Test MCP OAuth failed: access_denied");
    await new Promise((resolve) => setTimeout(resolve, 25));
    const erroredResponse = await fetch(`${erroredUri}?error=access_denied`);
    expect(erroredResponse.status).toBe(400);
    await expect(erroredResponse.text()).resolves.toContain("OAuth failed");
    await erroredAssertion;

    await expect(
      waitForOauthCallback("http://127.0.0.1:33404/callback", "Test MCP", { timeoutMs: 10 }),
    ).rejects.toThrow("Timed out waiting for the Test MCP OAuth callback.");
  });
});
