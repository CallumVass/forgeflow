import { emptyStage, type StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { mockExecFn, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedIssue } from "../utils/git.js";
import { finalisePr } from "./pr-lifecycle.js";

const githubResolved: ResolvedIssue = {
  source: "github",
  key: "42",
  number: 42,
  title: "Test issue",
  body: "body",
  branch: "feat/issue-42",
};

/** Scripted responses for the git/gh commands `finalisePr` drives. */
function execResponses(overrides: Record<string, string> = {}): ReturnType<typeof mockExecFn> {
  return mockExecFn({
    "git push": "",
    "gh pr list": "", // no existing PR → create
    "gh pr create": "https://github.com/owner/repo/pull/77",
    "gh pr merge": "Merged!",
    "git checkout main": "",
    "git pull": "",
    ...overrides,
  });
}

describe("finalisePr", () => {
  it("non-autonomous mode: creates PR, merges it, returns to main, and appends a done merge stage", async () => {
    const onUpdate = vi.fn();
    const execFn = execResponses();
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, onUpdate });
    const implementorStage = emptyStage("implementor");
    implementorStage.status = "done";
    const stages: StageResult[] = [implementorStage];

    await finalisePr(githubResolved, pctx, { autonomous: false, stages });

    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("gh pr create"))).toBe(true);
    expect(calls.some((c) => c.includes("gh pr merge 77"))).toBe(true);
    expect(calls.some((c) => c.includes("git checkout main"))).toBe(true);

    const mergeStage = stages.find((s) => s.name === "merge");
    expect(mergeStage).toBeDefined();
    expect(mergeStage?.status).toBe("done");
    expect(mergeStage?.output).toContain("#77");
    expect(onUpdate).toHaveBeenCalled();
  });

  it("autonomous mode: creates PR but does not merge or return to main", async () => {
    const execFn = execResponses();
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });
    const stages: StageResult[] = [];

    await finalisePr(githubResolved, pctx, { autonomous: true, stages });

    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("gh pr create"))).toBe(true);
    expect(calls.some((c) => c.includes("gh pr merge"))).toBe(false);
    expect(calls.some((c) => c.includes("git checkout main"))).toBe(false);
    expect(stages.find((s) => s.name === "merge")).toBeUndefined();
  });

  it("short-circuits when resolved.branch is empty: no PR, no merge, stages untouched", async () => {
    const execFn = execResponses();
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });
    const stages: StageResult[] = [emptyStage("implementor")];

    await finalisePr({ ...githubResolved, branch: "" }, pctx, { autonomous: false, stages });

    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("gh pr create"))).toBe(false);
    expect(calls.some((c) => c.includes("gh pr merge"))).toBe(false);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.name).toBe("implementor");
  });
});
