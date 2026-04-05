import { describe, expect, it, vi } from "vitest";
import type { ExecFn } from "./git-workflow.js";
import { ensurePr, mergePr, returnToMain, setupBranch, verifyOnBranch } from "./git-workflow.js";

/** Helper: create an exec mock that resolves with scripted responses */
function mockExec(responses: Record<string, string> = {}): ExecFn {
  return vi.fn(async (cmd: string, _cwd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    return "";
  });
}

describe("setupBranch", () => {
  it("creates a fresh branch when no prior commits exist ahead of main", async () => {
    const execFn = mockExec({
      "rev-list": "0",
      "checkout -b": "",
      "branch --show-current": "feat/issue-42",
    });

    const result = await setupBranch("/tmp", "feat/issue-42", execFn);

    expect(result).toEqual({ status: "fresh" });
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("checkout -b"), "/tmp");
  });

  it("resumes an existing branch with commits ahead and returns ahead count", async () => {
    const execFn = mockExec({
      "rev-list": "3",
      "checkout feat": "",
      "branch --show-current": "feat/issue-42",
    });

    const result = await setupBranch("/tmp", "feat/issue-42", execFn);

    expect(result).toEqual({ status: "resumed", ahead: 3 });
  });

  it("returns failed when branch checkout does not land on expected branch", async () => {
    const execFn = mockExec({
      "rev-list": "0",
      "checkout -b": "",
      "branch --show-current": "main",
    });

    const result = await setupBranch("/tmp", "feat/issue-42", execFn);

    expect(result).toEqual({
      status: "failed",
      error: expect.stringContaining("feat/issue-42"),
    });
  });
});

describe("ensurePr", () => {
  it("creates a PR when none exists and returns created: true", async () => {
    const execFn = mockExec({
      "pr list": "",
      "pr create": "https://github.com/repo/pull/7",
    });

    const result = await ensurePr("/tmp", "My title", "Body", "feat/issue-42", execFn);

    expect(result).toEqual({ number: 7, created: true });
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("pr create"), "/tmp");
  });

  it("returns the existing PR number when one already exists", async () => {
    const execFn = mockExec({
      "pr list": "5",
    });

    const result = await ensurePr("/tmp", "My title", "Body", "feat/issue-42", execFn);

    expect(result).toEqual({ number: 5, created: false });
  });
});

describe("mergePr", () => {
  it("squash-merges and succeeds when gh reports merge", async () => {
    const execFn = mockExec({
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
    const execFn = mockExec({});

    await returnToMain("/tmp", execFn);

    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("checkout main"), "/tmp");
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("pull"), "/tmp");
  });
});

describe("verifyOnBranch", () => {
  it("does not throw when on the expected branch", async () => {
    const execFn = mockExec({
      "branch --show-current": "feat/issue-42",
    });

    await expect(verifyOnBranch("/tmp", "feat/issue-42", execFn)).resolves.toBeUndefined();
  });

  it("throws when on the wrong branch", async () => {
    const execFn = mockExec({
      "branch --show-current": "main",
    });

    await expect(verifyOnBranch("/tmp", "feat/issue-42", execFn)).rejects.toThrow(/expected.*feat\/issue-42.*main/i);
  });
});
