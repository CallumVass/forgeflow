import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("runAtlassianRead", () => {
  it("surfaces reader errors through the narrowed content entry point", async () => {
    vi.doMock("@callumvass/forgeflow-shared/atlassian/content", () => ({
      fetchAtlassianContentFromUrl: vi.fn(async () => "Unsupported Atlassian URL: nope"),
      formatAtlassianContent: vi.fn(),
    }));

    const { runAtlassianRead } = await import("./atlassian-read.js");
    const result = await runAtlassianRead("https://example.com/nope", mockPipelineContext());

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unsupported Atlassian URL: nope");
  });
});
