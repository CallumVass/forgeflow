import { afterEach, describe, expect, it, vi } from "vitest";
import { mockExecFn } from "../test-utils.js";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("fetchConfluencePage", () => {
  it("fetches Confluence pages through Atlassian MCP", async () => {
    vi.doMock("../atlassian/index.js", () => ({
      fetchConfluencePageViaOauth: vi.fn(async () => ({ id: "77", title: "MCP", body: "Hello MCP" })),
    }));

    const { fetchConfluencePage } = await import("./confluence.js");
    const execSafe = mockExecFn({ curl: "should not be used" });
    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/77/Page", execSafe);

    expect(result).toEqual({ id: "77", title: "MCP", body: "Hello MCP" });
    expect(execSafe).not.toHaveBeenCalled();
  });

  it("returns an error string from the Atlassian client", async () => {
    vi.doMock("../atlassian/index.js", () => ({
      fetchConfluencePageViaOauth: vi.fn(
        async () => "Atlassian MCP is configured but no login was found. Run /atlassian-login.",
      ),
    }));

    const { fetchConfluencePage } = await import("./confluence.js");
    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/1/Page", mockExecFn());

    expect(typeof result).toBe("string");
    expect(result).toContain("/atlassian-login");
  });
});
