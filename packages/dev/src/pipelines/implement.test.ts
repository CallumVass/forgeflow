import {
  mockExecFn,
  mockForgeflowContext,
  mockPipelineContext,
  sequencedRunAgent,
} from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { runImplement } from "./implement.js";

// `implement-phases` / `implementation-run` both peek at filesystem-backed
// signals (blocked, findings). Stub the signal helpers to keep this a pure
// boundary test driven through `runAgentFn` + `execFn`.
vi.mock("@callumvass/forgeflow-shared/pipeline", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cleanSignal: vi.fn(),
    signalExists: vi.fn(() => false),
    readSignal: vi.fn(() => null),
  };
});

const ghIssueJson = JSON.stringify({ number: 42, title: "Test issue", body: "Issue body" });

/**
 * Build a scripted `execFn` covering every command `runImplement` drives in
 * a fresh run:
 *  - `gh issue view` (via execSafeFn)
 *  - `gh pr list --head ... ` for findPrNumber (resume-detection + post-ensurePr lookups)
 *  - `git rev-list main..<branch>` for setupBranch (0 → fresh path) AND
 *    `assertBranchHasCommits` inside ensurePr (>0 after the implementor
 *    committed). Both commands are literally identical, so we serve them
 *    from a sequential queue via `revList` instead of a substring mock.
 *  - `git branch -D / git checkout -b / git branch --show-current` for fresh checkout
 *  - `git diff main...HEAD` for reviewAndFix (empty → skip)
 *  - `git status --porcelain` for the assertBranchHasCommits diagnostic (empty)
 *  - `git push -u origin` + `gh pr create` for ensurePr
 *  - optionally `gh pr merge` + `git checkout main` + `git pull` when a caller
 *    asks `finalisePr` to merge (plain `/implement` no longer does)
 *
 * Overrides let individual tests change specific responses (existing-PR returns
 * a PR number, etc.). `revList` overrides the default `["0", "3"]` sequence
 * — use `["3", "3"]` for resume-with-commits, `["0", "0"]` to make ensurePr
 * refuse to push, etc.
 */
function scriptedExec(
  overrides: Record<string, string> = {},
  revList: string[] = ["0", "3"],
): ReturnType<typeof mockExecFn> {
  const base = mockExecFn({
    "gh pr list": "",
    "git branch -D": "",
    "git checkout -b": "",
    "git branch --show-current": "feat/issue-42",
    "git diff": "",
    "git status --porcelain": "",
    "git push": "",
    "gh pr create": "https://github.com/owner/repo/pull/7",
    "gh pr merge": "Merged!",
    "git checkout main": "",
    "git pull": "",
    ...overrides,
  });
  let revIdx = 0;
  return vi.fn(async (cmd: string, cwd?: string) => {
    if (cmd.includes("git rev-list")) {
      const response = revList[Math.min(revIdx, revList.length - 1)] ?? "0";
      revIdx++;
      return response;
    }
    return base(cmd, cwd);
  });
}

describe("runImplement orchestrator (integration)", () => {
  it("fresh path runs planner → architecture-reviewer → implementor → refactorer, creates a PR, and does not merge", async () => {
    // planner → architecture-reviewer → implementor → refactorer
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Step 1" },
      { output: "No architectural recommendations" },
      { output: "implemented" },
      { output: "refactored" },
    ]);
    const execFn = scriptedExec();
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueJson });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn, runAgentFn });

    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: true });

    expect(result.content[0]?.text).toContain("complete");
    expect(result.content[0]?.text).toContain("PR #7 is ready for review");
    const stages = result.details?.stages ?? [];
    const names = stages.map((s) => s.name);
    expect(names).toEqual(["planner", "architecture-reviewer", "implementor", "refactorer"]);
    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("gh pr create"))).toBe(true);
    expect(calls.some((c) => c.includes("gh pr merge 7"))).toBe(false);
  });

  it("resume-with-existing-PR: message contains 'PR #N already exists' and stages have no planner/implementor entries", async () => {
    const runAgentFn = sequencedRunAgent([]);
    const execFn = scriptedExec(
      {
        "gh pr list": "99", // findPrNumber → 99 → resume-existing-PR path
      },
      // If the implementation wrongly mutates the branch, asserting rev-list
      // was never called is handled below; seed a non-zero just in case.
      ["5", "5"],
    );
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueJson });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      execSafeFn,
      runAgentFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp" }),
    });

    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: true });

    expect(result.content[0]?.text).toContain("Resumed");
    expect(result.content[0]?.text).toContain("PR #99 already exists");
    const names = (result.details?.stages ?? []).map((s) => s.name);
    expect(names).not.toContain("planner");
    expect(names).not.toContain("implementor");
    expect(names).not.toContain("refactorer");
    // No mutating git commands were run for the resume-existing-PR path
    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("rev-list main..feat/issue-42"))).toBe(false);
    expect(calls.some((c) => c.includes("git checkout feat/issue-42"))).toBe(false);
  });

  it("resume-with-commits: pushes existing commits and returns text 'pushed existing commits and created PR'", async () => {
    // refactorer only → 1 agent call
    const runAgentFn = sequencedRunAgent([{ output: "refactored" }]);
    const execFn = scriptedExec(
      {
        "gh pr list": "",
        "git checkout feat/issue-42": "",
        "git branch --show-current": "feat/issue-42",
      },
      ["3", "3"], // setupBranch → resumed (3), ensurePr guard → 3 commits ahead
    );
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueJson });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn, runAgentFn });

    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: true });

    expect(result.content[0]?.text).toContain("pushed existing commits and created PR");
    // ensurePr ran (gh pr create or pr list with push)
    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("git push"))).toBe(true);
    // But merge was NOT invoked — resume-branch never merges
    expect(calls.some((c) => c.includes("gh pr merge"))).toBe(false);
  });

  it("error paths: resolveIssue string → non-error result; setupBranch failed → error result", async () => {
    // --- (a) resolveIssue returns a string (empty `gh issue view` output) ---
    const stringExec = scriptedExec();
    const stringSafe = mockExecFn({ "gh issue view": "" });
    const pctxString = mockPipelineContext({ cwd: "/tmp", execFn: stringExec, execSafeFn: stringSafe });
    const stringResult = await runImplement("42", pctxString, { skipPlan: false, skipReview: true });
    expect(stringResult.isError).not.toBe(true);
    expect(stringResult.content[0]?.text).toContain("Could not fetch issue #42");

    // --- (b) setupBranch failed (final branch --show-current returns 'main') ---
    const failExec = scriptedExec(
      {
        "git branch --show-current": "main",
      },
      ["0", "0"],
    );
    const failSafe = mockExecFn({ "gh issue view": ghIssueJson });
    const pctxFail = mockPipelineContext({ cwd: "/tmp", execFn: failExec, execSafeFn: failSafe });
    const failResult = await runImplement("42", pctxFail, { skipPlan: false, skipReview: true });
    expect(failResult.isError).toBe(true);
    expect(failResult.content[0]?.text).toContain("feat/issue-42");
  });
});
