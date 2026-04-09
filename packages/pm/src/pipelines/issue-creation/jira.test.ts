import { writeAtlassianOauthToken } from "@callumvass/forgeflow-shared/atlassian";
import { mockPipelineContext, mockRunAgent, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runJiraIssues } from "./jira.js";

const fixture = setupIsolatedHomeFixture("jira-pipeline");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runJiraIssues", () => {
  beforeEach(async () => {
    process.env.ATLASSIAN_CLIENT_ID = "client-id";
    process.env.ATLASSIAN_CLIENT_SECRET = "client-secret";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
    process.env.ATLASSIAN_JIRA_PROJECT = "PROJ";

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
    delete process.env.ATLASSIAN_JIRA_PROJECT;
    expect(fixture.homeDir).toBeTruthy();
  });

  it("plans Jira issue drafts then publishes them via Atlassian OAuth", async () => {
    const plannerOutput = [
      "```json",
      "[",
      '  { "summary": "Add dashboard filters", "description": "## Description\\nUsers can filter the dashboard." },',
      '  { "summary": "Ship saved views", "description": "## Description\\nUsers can save filtered views.", "issueType": "Task" }',
      "]",
      "```",
    ].join("\n");

    const runAgentFn = mockRunAgent(plannerOutput);
    const pctx = mockPipelineContext({ cwd: fixture.cwdDir, runAgentFn });

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("accessible-resources")) {
        return jsonResponse([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]);
      }
      if (url.includes("/wiki/api/v2/pages/999")) {
        return jsonResponse({
          id: "999",
          title: "Product requirements",
          body: { storage: { value: "<p>Users need dashboard filtering and saved views.</p>" } },
        });
      }
      if (url.endsWith("/rest/api/3/issue") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { fields: { summary: string } };
        if (body.fields.summary === "Add dashboard filters") {
          return jsonResponse({ id: "10001", key: "PROJ-101" });
        }
        if (body.fields.summary === "Ship saved views") {
          return jsonResponse({ id: "10002", key: "PROJ-102" });
        }
      }
      return jsonResponse({ message: `Unexpected URL ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runJiraIssues(
      ["https://example.atlassian.net/wiki/spaces/PM/pages/999/Product-Requirements"],
      "",
      pctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("PROJ-101, PROJ-102");
    expect(runAgentFn).toHaveBeenCalledWith("jira-issue-planner", expect.any(String), expect.any(Object));
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/rest/api/3/issue"))).toHaveLength(2);
  });
});
