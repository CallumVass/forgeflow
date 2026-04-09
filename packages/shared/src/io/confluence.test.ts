import { afterEach, describe, expect, it, vi } from "vitest";
import { writeAtlassianOauthToken } from "../atlassian/index.js";
import { mockExecFn } from "../test-utils.js";
import { setupIsolatedHomeFixture } from "../testing/test-utils.js";
import { fetchConfluencePage } from "./confluence.js";

setupIsolatedHomeFixture("confluence");

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ATLASSIAN_CLIENT_ID;
  delete process.env.ATLASSIAN_CLIENT_SECRET;
  delete process.env.ATLASSIAN_URL;
});

describe("fetchConfluencePage", () => {
  it("fetches Confluence pages through Atlassian OAuth", async () => {
    process.env.ATLASSIAN_CLIENT_ID = "client-id";
    process.env.ATLASSIAN_CLIENT_SECRET = "client-secret";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";
    await writeAtlassianOauthToken({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("accessible-resources")) {
        return new Response(
          JSON.stringify([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/wiki/api/v2/pages/77")) {
        return new Response(
          JSON.stringify({ id: "77", title: "OAuth", body: { storage: { value: "<p>Hello OAuth</p>" } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ message: `Unexpected URL ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const execSafe = mockExecFn({ curl: "should not be used" });
    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/77/Page", execSafe);

    expect(result).toEqual({ id: "77", title: "OAuth", body: "Hello OAuth" });
    expect(execSafe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error string when no Atlassian OAuth login exists", async () => {
    process.env.ATLASSIAN_CLIENT_ID = "client-id";
    process.env.ATLASSIAN_CLIENT_SECRET = "client-secret";
    process.env.ATLASSIAN_URL = "https://example.atlassian.net";

    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/1/Page", mockExecFn());

    expect(typeof result).toBe("string");
    expect(result).toContain("/atlassian-login");
  });
});
