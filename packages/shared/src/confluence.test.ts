import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchConfluencePage } from "./confluence.js";
import { mockExecFn } from "./test-utils.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.CONFLUENCE_URL = "https://example.atlassian.net";
  process.env.CONFLUENCE_EMAIL = "user@example.com";
  process.env.CONFLUENCE_TOKEN = "token-123";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("fetchConfluencePage", () => {
  it("flows the curl call through the injected execSafe spy and returns the parsed page", async () => {
    const responseJson = JSON.stringify({
      id: "999",
      title: "My Page",
      body: { storage: { value: "<p>Hello <strong>world</strong></p>" } },
    });
    const execSafe = mockExecFn({ curl: responseJson });

    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/999/Page", execSafe);

    expect(execSafe).toHaveBeenCalledTimes(1);
    const cmd = execSafe.mock.calls[0]?.[0] as string;
    expect(cmd).toContain("curl");
    expect(cmd).toContain("/wiki/api/v2/pages/999");
    expect(cmd).toContain("Authorization: Basic ");
    expect(result).toEqual({ id: "999", title: "My Page", body: "Hello **world**" });
  });

  it("returns an error string when env vars are missing", async () => {
    delete process.env.CONFLUENCE_TOKEN;
    const execSafe = mockExecFn();

    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/1/Page", execSafe);

    expect(typeof result).toBe("string");
    expect(execSafe).not.toHaveBeenCalled();
  });

  it("returns an error string when the curl invocation yields an empty body", async () => {
    const execSafe = mockExecFn({});

    const result = await fetchConfluencePage("https://example.atlassian.net/wiki/spaces/X/pages/123/Page", execSafe);

    expect(typeof result).toBe("string");
    expect(result as string).toContain("123");
  });
});
