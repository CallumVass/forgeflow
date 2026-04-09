import { writeAtlassianOauthToken } from "@callumvass/forgeflow-shared/atlassian";
import { emptyStage, type RunAgentFn } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInvestigate } from "./investigate.js";

const fixture = setupIsolatedHomeFixture("investigate-pipeline");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runInvestigate", () => {
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
    expect(fixture.homeDir).toBeTruthy();
  });

  it("prefetches extra Atlassian URLs mentioned in the investigation description", async () => {
    const runAgentFn = vi.fn<RunAgentFn>(async (agent, prompt, opts) => {
      const stage = opts.stages.find((entry) => entry.name === (opts.stageName ?? agent));
      if (stage) {
        stage.status = "done";
        stage.output = "done";
      }
      return { ...emptyStage(opts.stageName ?? agent), status: "done", output: String(prompt) };
    });
    const pctx = mockPipelineContext({ cwd: fixture.cwdDir, runAgentFn });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("accessible-resources")) {
        return jsonResponse([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]);
      }
      if (url.includes("/wiki/api/v2/pages/100")) {
        return jsonResponse({
          id: "100",
          title: "Investigation Template",
          body: { storage: { value: "<p>Template body</p>" } },
        });
      }
      if (url.includes("/wiki/api/v2/pages/200")) {
        return jsonResponse({
          id: "200",
          title: "Reference Page",
          body: { storage: { value: "<p>Reference body</p>" } },
        });
      }
      if (url.includes("/rest/api/3/issue/PROJ-7")) {
        return jsonResponse({
          fields: {
            summary: "OAuth Jira issue",
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Jira body" }] }],
            },
            issuetype: { name: "Task" },
          },
          names: {},
        });
      }
      return jsonResponse({ message: `Unexpected URL ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const description = [
      "Compare approaches using template https://example.atlassian.net/wiki/spaces/X/pages/100/Template",
      "and reference docs https://example.atlassian.net/wiki/spaces/X/pages/200/Reference-Page",
      "plus Jira context https://example.atlassian.net/browse/PROJ-7.",
    ].join(" ");

    const result = await runInvestigate(
      description,
      "https://example.atlassian.net/wiki/spaces/X/pages/100/Template",
      pctx,
    );

    expect(result.isError).toBeUndefined();
    expect(runAgentFn).toHaveBeenCalledWith("investigator", expect.any(String), expect.any(Object));

    const prompt = String(runAgentFn.mock.calls[0]?.[1] ?? "");
    expect(prompt).toContain('TEMPLATE (from Confluence page "Investigation Template"):\n\nTemplate body');
    expect(prompt).toContain("ADDITIONAL ATLASSIAN REFERENCES:");
    expect(prompt).toContain("# Confluence: Reference Page");
    expect(prompt).toContain("Reference body");
    expect(prompt).toContain("# Jira PROJ-7 (Task): OAuth Jira issue");
    expect(prompt).toContain("Jira body");
    expect(prompt.match(/Investigation Template/g)).toHaveLength(1);
  });
});
