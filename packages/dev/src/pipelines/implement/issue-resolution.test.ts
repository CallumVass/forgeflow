import { mockExecFn, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it } from "vitest";
import { resolveIssuePlan } from "./issue-resolution.js";

const ghIssueResponse = JSON.stringify({ number: 42, title: "Test issue", body: "Issue body" });

describe("resolveIssuePlan", () => {
  it("maps existing PR → { kind: 'existing-pr', prNumber } and does NOT mutate the branch", async () => {
    const execFn = mockExecFn({
      "gh pr list": "99",
      // These are the git calls setupBranch would make — they must NOT be invoked.
      "git rev-list": "5",
      "git checkout": "",
      "git branch -D": "",
    });
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const plan = await resolveIssuePlan("42", pctx);

    expect("error" in plan).toBe(false);
    if ("error" in plan) throw new Error("unreachable");
    expect(plan.resume).toEqual({ kind: "existing-pr", prNumber: 99 });
    expect(plan.issueLabel).toBe("#42: Test issue");
    expect(plan.issueContext).toContain("Issue #42: Test issue");

    // Invariant: existing-PR path must not run any branch-mutating command.
    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.startsWith("git checkout"))).toBe(false);
    expect(calls.some((c) => c.includes("git branch -D"))).toBe(false);
    expect(calls.some((c) => c.includes("rev-list main..feat/issue-42"))).toBe(false);
  });

  it("maps setupBranch status 'resumed' → { kind: 'resume-branch' }", async () => {
    // rev-list returns > 0 → setupBranch treats branch as resumed.
    const execFn = mockExecFn({
      "gh pr list": "",
      "rev-list main..feat/issue-42": "3",
      "git checkout feat/issue-42": "",
      "git branch --show-current": "feat/issue-42",
    });
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const plan = await resolveIssuePlan("42", pctx);

    if ("error" in plan) throw new Error("unreachable");
    expect(plan.resume).toEqual({ kind: "resume-branch" });
  });

  it("maps fresh vs failed setupBranch: final branch matches → 'fresh'; mismatch → 'failed' with error text", async () => {
    // Fresh path: branch --show-current matches resolved.branch.
    const freshExec = mockExecFn({
      "gh pr list": "",
      "rev-list main..feat/issue-42": "0",
      "git branch -D": "",
      "git checkout -b feat/issue-42": "",
      "git branch --show-current": "feat/issue-42",
    });
    const execSafeFn = mockExecFn({ "gh issue view": ghIssueResponse });
    const freshPlan = await resolveIssuePlan("42", mockPipelineContext({ cwd: "/tmp", execFn: freshExec, execSafeFn }));
    if ("error" in freshPlan) throw new Error("unreachable");
    expect(freshPlan.resume).toEqual({ kind: "fresh" });

    // Failed path: branch --show-current returns 'main'.
    const failedExec = mockExecFn({
      "gh pr list": "",
      "rev-list main..feat/issue-42": "0",
      "git branch -D": "",
      "git checkout -b feat/issue-42": "",
      "git branch --show-current": "main",
    });
    const failedPlan = await resolveIssuePlan(
      "42",
      mockPipelineContext({ cwd: "/tmp", execFn: failedExec, execSafeFn }),
    );
    if ("error" in failedPlan) throw new Error("unreachable");
    expect(failedPlan.resume.kind).toBe("failed");
    if (failedPlan.resume.kind !== "failed") throw new Error("unreachable");
    expect(failedPlan.resume.error).toContain("feat/issue-42");
  });

  it("returns { error } when resolveIssue yields a string, without calling setupBranch", async () => {
    // `gh issue view` returning empty string triggers "Could not fetch" error from resolveIssue.
    const execFn = mockExecFn({ "gh pr list": "", "rev-list": "0" });
    const execSafeFn = mockExecFn({ "gh issue view": "" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const plan = await resolveIssuePlan("42", pctx);

    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("unreachable");
    expect(plan.error).toContain("Could not fetch issue #42");

    // setupBranch would call rev-list / git checkout — must NOT have happened.
    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("rev-list"))).toBe(false);
    expect(calls.some((c) => c.startsWith("git checkout"))).toBe(false);
  });
});
