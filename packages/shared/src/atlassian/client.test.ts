import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import {
  fetchAtlassianContentFromUrl,
  fetchConfluencePageViaOauth,
  fetchJiraIssueViaOauth,
  formatAtlassianContent,
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

  it("falls back to the legacy Confluence REST API when v2 rejects the token", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("accessible-resources")) {
        return jsonResponse([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]);
      }
      if (url.includes("/wiki/api/v2/pages/999")) {
        return jsonResponse({ message: "Unauthorized; scope does not match" }, 401);
      }
      if (url.includes("/wiki/rest/api/content/999")) {
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it("dispatches Atlassian URLs to Jira or Confluence readers and formats the result", async () => {
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
            issuetype: { name: "Task" },
          },
          names: {},
        });
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

    const jira = await fetchAtlassianContentFromUrl("https://example.atlassian.net/browse/PROJ-7");
    const confluence = await fetchAtlassianContentFromUrl("https://example.atlassian.net/wiki/spaces/X/pages/999/Page");

    expect(jira).toEqual({
      kind: "jira",
      url: "https://example.atlassian.net/browse/PROJ-7",
      key: "PROJ-7",
      title: "OAuth Jira issue",
      issueType: "Task",
      body: "Hello Jira",
    });
    expect(confluence).toEqual({
      kind: "confluence",
      url: "https://example.atlassian.net/wiki/spaces/X/pages/999/Page",
      id: "999",
      title: "OAuth Page",
      body: "Hello **OAuth**",
    });
    expect(formatAtlassianContent(jira as Exclude<typeof jira, string>)).toContain(
      "# Jira PROJ-7 (Task): OAuth Jira issue",
    );
    expect(formatAtlassianContent(confluence as Exclude<typeof confluence, string>)).toContain(
      "# Confluence: OAuth Page",
    );
  });
});
