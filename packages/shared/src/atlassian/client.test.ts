import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import {
  fetchConfluencePageViaOauth,
  fetchJiraIssueViaOauth,
  getAtlassianOauthTokenPath,
  writeAtlassianOauthToken,
} from "./index.js";

const fixture = setupIsolatedHomeFixture("atlassian-oauth");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Atlassian OAuth client", () => {
  beforeEach(async () => {
    process.env.ATLASSIAN_CLIENT_ID = "client-id";
    process.env.ATLASSIAN_CLIENT_SECRET = "client-secret";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
    await writeAtlassianOauthToken({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ATLASSIAN_CLIENT_ID;
    delete process.env.ATLASSIAN_CLIENT_SECRET;
    delete process.env.ATLASSIAN_URL;
    expect(getAtlassianOauthTokenPath().startsWith(fixture.homeDir)).toBe(true);
  });

  it("fetches a Confluence page through Atlassian OAuth", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("accessible-resources")) {
        return jsonResponse([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]);
      }
      if (url.includes("/wiki/api/v2/pages/999")) {
        return jsonResponse({
          id: "999",
          title: "OAuth Page",
          body: { storage: { value: "<p>Hello <strong>OAuth</strong></p>" } },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchConfluencePageViaOauth("https://example.atlassian.net/wiki/spaces/X/pages/999/Page");

    expect(result).toEqual({ id: "999", title: "OAuth Page", body: "Hello **OAuth**" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches a Jira issue through Atlassian OAuth and flattens ADF/custom fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("accessible-resources")) {
        return jsonResponse([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]);
      }
      if (url.includes("/rest/api/3/issue/PROJ-7")) {
        return jsonResponse({
          fields: {
            summary: "OAuth Jira issue",
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Hello Jira" }] }],
            },
            status: { name: "Open" },
            priority: { name: "High" },
            issuetype: { name: "Task" },
            customfield_10001: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Must do X" }] }],
            },
            customfield_10002: 5,
            customfield_10003: "Sprint 9",
          },
          names: {
            customfield_10001: "Acceptance Criteria",
            customfield_10002: "Story Points",
            customfield_10003: "Sprint",
          },
        });
      }
      return jsonResponse({ message: `Unexpected URL ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJiraIssueViaOauth("PROJ-7");

    expect(result).toEqual({
      key: "PROJ-7",
      title: "OAuth Jira issue",
      issueType: "Task",
      body: [
        "Hello Jira",
        "## Acceptance Criteria\nMust do X",
        "**Status:** Open",
        "**Priority:** High",
        "**Story Points:** 5",
        "**Sprint:** Sprint 9",
      ].join("\n\n"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
