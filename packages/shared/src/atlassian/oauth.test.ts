import { describe, expect, it } from "vitest";
import { getAtlassianOauthConfig } from "./oauth.js";

describe("getAtlassianOauthConfig", () => {
  it("uses granular Confluence read scopes by default", () => {
    const config = getAtlassianOauthConfig({
      ATLASSIAN_CLIENT_ID: "client-id",
      ATLASSIAN_CLIENT_SECRET: "client-secret",
      ATLASSIAN_URL: "https://example.atlassian.net",
    });

    expect(config).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://127.0.0.1:33389/callback",
      scopes: [
        "offline_access",
        "read:jira-work",
        "write:jira-work",
        "read:confluence-content.all",
        "read:page:confluence",
        "read:content.metadata:confluence",
        "read:content-details:confluence",
        "read:space:confluence",
      ],
      siteUrl: "https://example.atlassian.net",
    });
  });

  it("lets ATLASSIAN_SCOPES override the default scope list", () => {
    const config = getAtlassianOauthConfig({
      ATLASSIAN_CLIENT_ID: "client-id",
      ATLASSIAN_CLIENT_SECRET: "client-secret",
      ATLASSIAN_SCOPES: "offline_access read:jira-work read:page:confluence",
    });

    expect(config).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://127.0.0.1:33389/callback",
      scopes: ["offline_access", "read:jira-work", "read:page:confluence"],
      siteUrl: undefined,
    });
  });
});
