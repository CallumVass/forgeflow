import { describe, expect, it } from "vitest";
import { getAtlassianOauthConfig, getAtlassianOauthTokenPath } from "./oauth.js";

describe("Atlassian OAuth compatibility exports", () => {
  it("maps the legacy config helper to Atlassian MCP config", () => {
    const config = getAtlassianOauthConfig({
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

  it("maps the legacy token path helper to the MCP OAuth state path", () => {
    expect(getAtlassianOauthTokenPath()).toContain("forgeflow-atlassian-mcp-oauth.json");
  });
});
