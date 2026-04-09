import { describe, expect, it } from "vitest";
import { buildOpenExternalUrlAttempts } from "./oauth.js";

describe("buildOpenExternalUrlAttempts", () => {
  it("quotes OAuth URLs for cmd start on native Windows", () => {
    const attempts = buildOpenExternalUrlAttempts(
      "https://auth.atlassian.com/authorize?audience=api.atlassian.com&scope=offline_access read:jira-work",
      "win32",
      {},
    );

    expect(attempts).toEqual([
      [
        "cmd",
        [
          "/c",
          "start",
          "",
          '"https://auth.atlassian.com/authorize?audience=api.atlassian.com&scope=offline_access read:jira-work"',
        ],
      ],
    ]);
  });

  it("includes quoted cmd.exe fallback when running inside WSL", () => {
    const attempts = buildOpenExternalUrlAttempts(
      "https://auth.atlassian.com/authorize?audience=api.atlassian.com&scope=offline_access&redirect_uri=http://127.0.0.1:33389/callback",
      "linux",
      { WSL_DISTRO_NAME: "Ubuntu" },
    );

    expect(attempts).toEqual([
      [
        "wslview",
        [
          "https://auth.atlassian.com/authorize?audience=api.atlassian.com&scope=offline_access&redirect_uri=http://127.0.0.1:33389/callback",
        ],
      ],
      [
        "cmd.exe",
        [
          "/c",
          "start",
          "",
          '"https://auth.atlassian.com/authorize?audience=api.atlassian.com&scope=offline_access&redirect_uri=http://127.0.0.1:33389/callback"',
        ],
      ],
      [
        "xdg-open",
        [
          "https://auth.atlassian.com/authorize?audience=api.atlassian.com&scope=offline_access&redirect_uri=http://127.0.0.1:33389/callback",
        ],
      ],
    ]);
  });
});
