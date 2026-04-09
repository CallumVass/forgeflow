import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { resolveDiffTarget } from "./diff.js";

describe("resolveDiffTarget", () => {
  it("returns PR diff command and PR number when target is a numeric string", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "42", execFn);

    expect(result).toEqual({ diffCmd: "gh pr diff 42", prNumber: "42" });
  });

  it("returns branch diff command when target starts with --branch", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "--branch feat/foo", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...feat/foo", prNumber: undefined });
  });

  it("defaults to HEAD when --branch has no branch name", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "--branch", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: undefined });
  });

  it("auto-detects PR number from current branch when target is empty", async () => {
    const execFn = mockExecFn({ "gh pr view": "99" });
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: "99" });
    expect(execFn).toHaveBeenCalledWith("gh pr view --json number --jq .number", "/tmp");
  });

  it("returns no PR number when auto-detect fails on empty target", async () => {
    const execFn = mockExecFn({});
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: undefined });
  });
});
