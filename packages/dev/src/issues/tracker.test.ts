import { writeAtlassianOauthToken } from "@callumvass/forgeflow-shared/atlassian";
import { mockExecFn, setupIsolatedHomeFixture } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIssue } from "./tracker.js";

setupIsolatedHomeFixture("resolve-issue");

const ghIssueResponse = JSON.stringify({ number: 42, title: "GH issue", body: "GH body" });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ATLASSIAN_CLIENT_ID;
  delete process.env.ATLASSIAN_CLIENT_SECRET;
  delete process.env.ATLASSIAN_URL;
});

async function configureOauth(fetchMock: ReturnType<typeof vi.fn>) {
  process.env.ATLASSIAN_CLIENT_ID = "client-id";
  process.env.ATLASSIAN_CLIENT_SECRET = "client-secret";
  process.env.ATLASSIAN_URL = "https://example.atlassian.net";
  await writeAtlassianOauthToken({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 3_600_000,
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("resolveIssue", () => {
  it("uses execSafeFn for `gh issue view` and returns a GitHub-shaped ResolvedIssue", async () => {
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse });
    const execFn = mockExecFn();

    const result = await resolveIssue("/tmp", "42", { execFn, execSafeFn });

    expect(execSafeFn).toHaveBeenCalledWith(expect.stringContaining("gh issue view 42"), "/tmp");
    expect(result).toEqual({
      source: "github",
      key: "42",
      number: 42,
      title: "GH issue",
      body: "GH body",
      branch: "feat/issue-42",
    });
  });

  it("resolves Jira issues through Atlassian OAuth", async () => {
    await configureOauth(
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("accessible-resources")) {
          return new Response(
            JSON.stringify([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/rest/api/3/issue/CUS-123")) {
          return new Response(
            JSON.stringify({
              fields: {
                summary: "OAuth Jira issue",
                description: {
                  type: "doc",
                  version: 1,
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Body via OAuth" }] }],
                },
              },
              names: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: `Unexpected URL ${url}` }), { status: 500 });
      }),
    );

    const result = await resolveIssue("/tmp", "CUS-123", { execFn: mockExecFn(), execSafeFn: mockExecFn() });

    expect(result).toEqual({
      source: "jira",
      key: "CUS-123",
      number: 0,
      title: "OAuth Jira issue",
      body: "Body via OAuth",
      branch: "feat/CUS-123-oauth-jira-issue",
    });
  });

  it("detects Jira feature branches and preserves the existing branch name", async () => {
    await configureOauth(
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("accessible-resources")) {
          return new Response(
            JSON.stringify([{ id: "cloud-1", url: "https://example.atlassian.net", name: "Example", scopes: [] }]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/rest/api/3/issue/CUS-9")) {
          return new Response(JSON.stringify({ fields: { summary: "Foo bar", description: null }, names: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ message: `Unexpected URL ${url}` }), { status: 500 });
      }),
    );

    const result = await resolveIssue("/tmp", undefined, {
      execFn: mockExecFn({ "git branch --show-current": "feat/CUS-9-foo" }),
      execSafeFn: mockExecFn(),
    });

    if (typeof result === "string") throw new Error("expected ResolvedIssue, got error string");
    expect(result.source).toBe("jira");
    expect(result.key).toBe("CUS-9");
    expect(result.branch).toBe("feat/CUS-9-foo");
  });

  it("with no arg, detects GitHub feature branches via `git branch --show-current`", async () => {
    const execFn = mockExecFn({ "git branch --show-current": "feat/issue-7" });
    const execSafeFn = mockExecFn({ "gh issue view": JSON.stringify({ number: 7, title: "Auto", body: "B" }) });

    const result = await resolveIssue("/tmp", undefined, { execFn, execSafeFn });

    expect(execFn).toHaveBeenCalledWith("git branch --show-current", "/tmp");
    expect(result).toMatchObject({ source: "github", number: 7, branch: "feat/issue-7" });
  });

  it("returns a free-text ResolvedIssue without invoking exec when given a description", async () => {
    const execFn = mockExecFn();
    const execSafeFn = mockExecFn();

    const result = await resolveIssue("/tmp", "Add user signup", { execFn, execSafeFn });

    expect(result).toEqual({
      source: "github",
      key: "",
      number: 0,
      title: "Add user signup",
      body: "Add user signup",
      branch: "",
    });
    expect(execFn).not.toHaveBeenCalled();
    expect(execSafeFn).not.toHaveBeenCalled();
  });

  it("returns an error string for malformed GitHub issue JSON", async () => {
    const result = await resolveIssue("/tmp", "42", {
      execFn: mockExecFn(),
      execSafeFn: mockExecFn({ "gh issue view": "{ not json" }),
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("Could not parse issue #42");
  });

  it("returns an error string when the current branch is unrecognised", async () => {
    const result = await resolveIssue("/tmp", undefined, {
      execFn: mockExecFn({ "git branch --show-current": "main" }),
      execSafeFn: mockExecFn(),
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("main");
  });
});
