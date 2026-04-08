import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { assertBranchHasCommits, ensurePr, findPrNumber, mergePr, returnToMain } from "./pr-lifecycle.js";

describe("ensurePr", () => {
  it("creates a PR when none exists and returns created: true", async () => {
    const execFn = mockExecFn({
      "rev-list": "3",
      "pr list": "",
      "pr create": "https://github.com/repo/pull/7",
    });

    const result = await ensurePr("/tmp", "My title", "Body", "feat/issue-42", execFn);

    expect(result).toEqual({ number: 7, created: true });
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("pr create"), "/tmp");
  });

  it("returns the existing PR number when one already exists", async () => {
    const execFn = mockExecFn({
      "rev-list": "2",
      "pr list": "5",
    });

    const result = await ensurePr("/tmp", "My title", "Body", "feat/issue-42", execFn);

    expect(result).toEqual({ number: 5, created: false });
  });

  it("refuses to push a zero-commit branch and reports untracked files", async () => {
    const execFn = mockExecFn({
      "rev-list": "0",
      "status --porcelain": "?? packages/shared/src/run-dir.ts\n?? packages/shared/src/run-dir.test.ts",
    });

    await expect(ensurePr("/tmp", "My title", "Body", "feat/issue-127", execFn)).rejects.toThrow(
      /feat\/issue-127 has 0 commits ahead of main[\s\S]*run-dir\.ts[\s\S]*forgot to 'git add'/,
    );

    // Must NOT have attempted the push or the PR create.
    expect(execFn).not.toHaveBeenCalledWith(expect.stringContaining("git push"), expect.anything());
    expect(execFn).not.toHaveBeenCalledWith(expect.stringContaining("pr create"), expect.anything());
  });

  it("refuses to push a zero-commit branch and reports a clean working tree", async () => {
    const execFn = mockExecFn({
      "rev-list": "0",
      "status --porcelain": "",
    });

    await expect(ensurePr("/tmp", "T", "B", "feat/issue-9", execFn)).rejects.toThrow(
      /0 commits ahead of main[\s\S]*Working tree is clean/,
    );
  });
});

describe("assertBranchHasCommits", () => {
  it("resolves when the branch has commits ahead of main", async () => {
    const execFn = mockExecFn({ "rev-list": "1" });
    await expect(assertBranchHasCommits("/tmp", "feat/issue-1", execFn)).resolves.toBeUndefined();
  });

  it("still throws even if git status itself errors", async () => {
    const execFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("rev-list")) return "0";
      if (cmd.includes("status --porcelain")) throw new Error("git status blew up");
      return "";
    });
    await expect(assertBranchHasCommits("/tmp", "feat/issue-1", execFn)).rejects.toThrow(/0 commits ahead of main/);
  });
});

describe("findPrNumber", () => {
  it("parses the gh pr list output as a PR number when present, and returns null on empty/'null' output", async () => {
    const present = mockExecFn({ "pr list": "42" });
    expect(await findPrNumber("/tmp", "feat/issue-42", present)).toBe(42);

    const empty = mockExecFn({ "pr list": "" });
    expect(await findPrNumber("/tmp", "feat/issue-42", empty)).toBeNull();

    const literalNull = mockExecFn({ "pr list": "null" });
    expect(await findPrNumber("/tmp", "feat/issue-42", literalNull)).toBeNull();
  });
});

describe("mergePr", () => {
  it("squash-merges and succeeds when gh reports merge", async () => {
    const execFn = mockExecFn({
      "pr merge": "Merged",
    });

    await expect(mergePr("/tmp", 7, execFn)).resolves.toBeUndefined();
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("--squash --delete-branch"), "/tmp");
  });

  it("falls back to checking PR state when merge output is ambiguous", async () => {
    const execFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("pr merge")) return "";
      if (cmd.includes("pr view")) return "MERGED";
      return "";
    });

    await expect(mergePr("/tmp", 7, execFn)).resolves.toBeUndefined();
  });

  it("throws when merge fails and PR is not in MERGED state", async () => {
    const execFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("pr merge")) return "";
      if (cmd.includes("pr view")) return "OPEN";
      return "";
    });

    await expect(mergePr("/tmp", 7, execFn)).rejects.toThrow(/merge.*7/i);
  });
});

describe("returnToMain", () => {
  it("checks out main and pulls", async () => {
    const execFn = mockExecFn({});

    await returnToMain("/tmp", execFn);

    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("checkout main"), "/tmp");
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("pull"), "/tmp");
  });
});
