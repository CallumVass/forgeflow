import type { ExecFn } from "@callumvass/forgeflow-shared/exec";
import { describe, expect, it, vi } from "vitest";
import { resolveDiffTarget } from "./review-diff.js";

/** Helper: create an exec mock that resolves with scripted responses */
function mockExec(responses: Record<string, string> = {}): ExecFn {
  return vi.fn(async (cmd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    return "";
  });
}

describe("resolveDiffTarget", () => {
  it("returns PR diff command and PR number when target is a numeric string", async () => {
    const execFn = mockExec();
    const result = await resolveDiffTarget("/tmp", "42", execFn);

    expect(result).toEqual({ diffCmd: "gh pr diff 42", prNumber: "42" });
  });

  it("returns branch diff command when target starts with --branch", async () => {
    const execFn = mockExec();
    const result = await resolveDiffTarget("/tmp", "--branch feat/foo", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...feat/foo", prNumber: undefined });
  });

  it("defaults to HEAD when --branch has no branch name", async () => {
    const execFn = mockExec();
    const result = await resolveDiffTarget("/tmp", "--branch", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: undefined });
  });

  it("auto-detects PR number from current branch when target is empty", async () => {
    const execFn = mockExec({ "gh pr view": "99" });
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: "99" });
    expect(execFn).toHaveBeenCalledWith("gh pr view --json number --jq .number", "/tmp");
  });

  it("returns no PR number when auto-detect fails on empty target", async () => {
    const execFn = mockExec({});
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: undefined });
  });
});
