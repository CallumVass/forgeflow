import { mockExecFn } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import {
  assertBranchHasCommits,
  ensurePr,
  fetchFailedCiLogs,
  findPrNumber,
  mergePr,
  returnToMain,
  waitForChecks,
} from "./pr-lifecycle.js";

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

describe("waitForChecks", () => {
  it("blocks on --watch then returns passed when every check's bucket is pass/skipping", async () => {
    const execSafeFn = mockExecFn({
      "--watch": "",
      "--json bucket,name": JSON.stringify([
        { bucket: "pass", name: "build" },
        { bucket: "pass", name: "test" },
        { bucket: "skipping", name: "optional-lint" },
      ]),
    });

    const result = await waitForChecks("/tmp", 7, execSafeFn);

    expect(result).toEqual({ passed: true, failedChecks: [] });
    expect(execSafeFn).toHaveBeenCalledWith(expect.stringMatching(/gh pr checks 7 --watch/), "/tmp");
  });

  it("collects fail/cancel check names and reports passed:false", async () => {
    const execSafeFn = mockExecFn({
      "--watch": "",
      "--json bucket,name": JSON.stringify([
        { bucket: "pass", name: "build" },
        { bucket: "fail", name: "unit-tests" },
        { bucket: "cancel", name: "integration" },
      ]),
    });

    const result = await waitForChecks("/tmp", 7, execSafeFn);

    expect(result.passed).toBe(false);
    expect(result.failedChecks.sort()).toEqual(["integration", "unit-tests"]);
  });

  it("returns passed:false with empty failedChecks when the rollup JSON is unparseable", async () => {
    const execSafeFn = mockExecFn({
      "--watch": "",
      "--json bucket,name": "not json",
    });

    const result = await waitForChecks("/tmp", 7, execSafeFn);

    expect(result).toEqual({ passed: false, failedChecks: [] });
  });
});

describe("fetchFailedCiLogs", () => {
  it("returns logs for the latest failed run on the branch", async () => {
    const execSafeFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("gh run list")) return "1234567890";
      if (cmd.includes("gh run view 1234567890 --log-failed")) return "actual CI failure output";
      return "";
    });

    const logs = await fetchFailedCiLogs("/tmp", "feat/issue-42", execSafeFn);

    expect(logs).toBe("actual CI failure output");
  });

  it("returns empty string when no failed run exists on the branch", async () => {
    const execSafeFn = mockExecFn({ "gh run list": "" });

    const logs = await fetchFailedCiLogs("/tmp", "feat/issue-42", execSafeFn);

    expect(logs).toBe("");
  });
});
