import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("runAtlassianRead", () => {
  it("formats Atlassian content through the narrowed content entry point", async () => {
    vi.doMock("@callumvass/forgeflow-shared/atlassian/content", () => ({
      fetchAtlassianContentFromUrl: vi.fn(async (url: string) => ({
        kind: "jira",
        url,
        key: "PROJ-7",
        title: "MCP Jira issue",
        issueType: "Task",
        body: "Jira body",
      })),
      formatAtlassianContent: vi.fn(
        (content: { key: string; issueType?: string; title: string; url: string; body: string }) =>
          `# Jira ${content.key} (${content.issueType}): ${content.title}\n\nSource: ${content.url}\n\n${content.body}`,
      ),
    }));

    const { runAtlassianRead } = await import("./atlassian-read.js");
    const result = await runAtlassianRead("https://example.atlassian.net/browse/PROJ-7", mockPipelineContext());

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("# Jira PROJ-7 (Task): MCP Jira issue");
    expect(result.content[0]?.text).toContain("Source: https://example.atlassian.net/browse/PROJ-7");
  });
});
