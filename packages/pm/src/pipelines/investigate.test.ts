import { emptyStage, type RunAgentFn } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = setupIsolatedHomeFixture("investigate-pipeline");

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  expect(fixture.homeDir).toBeTruthy();
});

describe("runInvestigate", () => {
  it("prefetches extra Atlassian URLs mentioned in the investigation description", async () => {
    vi.doMock("@callumvass/forgeflow-shared/confluence", () => ({
      fetchConfluencePage: vi.fn(async (url: string) => {
        if (url.includes("/pages/100/")) return { id: "100", title: "Investigation Template", body: "Template body" };
        if (url.includes("/pages/200/")) return { id: "200", title: "Reference Page", body: "Reference body" };
        return `Unexpected URL ${url}`;
      }),
    }));
    vi.doMock("@callumvass/forgeflow-shared/atlassian/jira", () => ({
      extractJiraKey: (input: string) => {
        const match = input.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
        return match?.[0] ?? null;
      },
    }));
    vi.doMock("@callumvass/forgeflow-shared/atlassian/content", () => ({
      fetchAtlassianContentFromUrl: vi.fn(async (url: string) => {
        if (url.includes("/pages/200/")) {
          return {
            kind: "confluence",
            url,
            id: "200",
            title: "Reference Page",
            body: "Reference body",
          };
        }
        return {
          kind: "jira",
          url,
          key: "PROJ-7",
          title: "MCP Jira issue",
          issueType: "Task",
          body: "Jira body",
        };
      }),
      formatAtlassianContent: (content: {
        kind: string;
        title: string;
        body: string;
        key?: string;
        issueType?: string;
        url: string;
      }) =>
        content.kind === "jira"
          ? `# Jira ${content.key} (${content.issueType}): ${content.title}\n\nSource: ${content.url}\n\n${content.body}`
          : `# Confluence: ${content.title}\n\nSource: ${content.url}\n\n${content.body}`,
    }));

    const { runInvestigate } = await import("./investigate.js");
    const runAgentFn = vi.fn<RunAgentFn>(async (agent, prompt, opts) => {
      const stage = opts.stages.find((entry) => entry.name === (opts.stageName ?? agent));
      if (stage) {
        stage.status = "done";
        stage.output = "done";
      }
      return { ...emptyStage(opts.stageName ?? agent), status: "done", output: String(prompt) };
    });
    const pctx = mockPipelineContext({ cwd: fixture.cwdDir, runAgentFn });

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
    expect(prompt).toContain("# Jira PROJ-7 (Task): MCP Jira issue");
    expect(prompt).toContain("Jira body");
    expect(prompt.match(/Investigation Template/g)).toHaveLength(1);
  });
});
