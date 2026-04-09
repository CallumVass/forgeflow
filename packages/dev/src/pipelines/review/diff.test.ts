import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { resolveDiffTarget } from "./diff.js";

describe("resolveDiffTarget", () => {
  it("returns PR checkout + diff commands and PR number when target is a numeric string", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "42", execFn);

    expect(result).toEqual({ diffCmd: "gh pr diff 42", prNumber: "42", setupCmds: ["gh pr checkout 42"] });
  });

  it("returns branch checkout + diff commands when target starts with --branch", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "--branch feat/foo", execFn);

    expect(result).toEqual({
      diffCmd: "git diff main...HEAD",
      setupCmds: [
        'git fetch origin "feat/foo" 2>/dev/null || true',
        'git checkout "feat/foo" 2>/dev/null || git checkout -b "feat/foo" --track "origin/feat/foo"',
      ],
    });
  });

  it("defaults to HEAD when --branch has no branch name", async () => {
    const execFn = mockExecFn();
    const result = await resolveDiffTarget("/tmp", "--branch", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", setupCmds: [] });
  });

  it("auto-detects PR number from current branch when target is empty", async () => {
    const execFn = mockExecFn({ "gh pr view": "99" });
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: "99", setupCmds: [] });
    expect(execFn).toHaveBeenCalledWith("gh pr view --json number --jq .number", "/tmp");
  });

  it("returns no PR number when auto-detect fails on empty target", async () => {
    const execFn = mockExecFn({});
    const result = await resolveDiffTarget("/tmp", "", execFn);

    expect(result).toEqual({ diffCmd: "git diff main...HEAD", prNumber: undefined, setupCmds: [] });
  });
});
