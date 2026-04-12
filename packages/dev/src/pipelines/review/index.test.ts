import { mockExecFn, mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("./diff.js", () => ({
  resolveDiffTarget: vi.fn(async () => ({ diffCmd: "gh pr diff 5", prNumber: "5", setupCmds: ["gh pr checkout 5"] })),
}));

vi.mock("./orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: false, findings: "Bug found in foo.ts" })),
  runStandaloneReviewPipeline: vi.fn(async () => ({
    hasBlockingFindings: true,
    blockingFindings: "Bug found in foo.ts",
    report: "Bug found in foo.ts",
  })),
}));

vi.mock("./comments.js", () => ({
  proposeAndPostComments: vi.fn(async () => {}),
}));

import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { resolveReviewChangedFiles, runReview } from "./index.js";
import { runReviewPipeline, runStandaloneReviewPipeline } from "./orchestrator.js";

describe("runReview composition root", () => {
  it("resolves changed files for PR targets via the review boundary and falls back to the PR base branch when main...HEAD is empty", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({
      diffCmd: "gh pr diff 5",
      prNumber: "5",
      setupCmds: ["gh pr checkout 5"],
    });
    const execFn = mockExecFn({ "gh pr checkout 5": "" });
    const execSafeFn = mockExecFn({
      "git diff --name-only main...HEAD": "",
      "gh pr view 5 --json baseRefName --jq .baseRefName": "main",
      'git fetch origin "main" 2>/dev/null || true': "",
      'git diff --name-only "origin/main"...HEAD': "src/foo.ts\nsrc/bar.ts\n",
    });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const changedFiles = await resolveReviewChangedFiles("5", pctx);

    expect(changedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(resolveDiffTarget).toHaveBeenCalledWith("/tmp", "5", pctx.execSafeFn);
    expect(execFn).toHaveBeenCalledWith("gh pr checkout 5", "/tmp");
    expect(execSafeFn).toHaveBeenCalledWith("git diff --name-only main...HEAD", "/tmp");
    expect(execSafeFn).toHaveBeenCalledWith("gh pr view 5 --json baseRefName --jq .baseRefName", "/tmp");
    expect(execSafeFn).toHaveBeenCalledWith('git fetch origin "main" 2>/dev/null || true', "/tmp");
    expect(execSafeFn).toHaveBeenCalledWith('git diff --name-only "origin/main"...HEAD', "/tmp");
    expect(execSafeFn).not.toHaveBeenCalledWith("git diff --name-only HEAD~1...HEAD", "/tmp");
  });

  it("returns no changed files for PR targets when it cannot resolve a reliable PR-wide fallback", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({
      diffCmd: "gh pr diff 5",
      prNumber: "5",
      setupCmds: ["gh pr checkout 5"],
    });
    const execFn = mockExecFn({ "gh pr checkout 5": "" });
    const execSafeFn = mockExecFn({
      "git diff --name-only main...HEAD": "",
      "gh pr view 5 --json baseRefName --jq .baseRefName": "",
    });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const changedFiles = await resolveReviewChangedFiles("5", pctx);

    expect(changedFiles).toEqual([]);
    expect(execSafeFn).toHaveBeenCalledWith("gh pr view 5 --json baseRefName --jq .baseRefName", "/tmp");
    expect(execSafeFn).not.toHaveBeenCalledWith('git fetch origin "main" 2>/dev/null || true', "/tmp");
    expect(execSafeFn).not.toHaveBeenCalledWith('git diff --name-only "origin/main"...HEAD', "/tmp");
    expect(execSafeFn).not.toHaveBeenCalledWith("git diff --name-only HEAD~1...HEAD", "/tmp");
  });

  it("resolves changed files for branch targets via the review boundary", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({
      diffCmd: "git diff main...HEAD",
      setupCmds: ['git checkout "feat/foo"'],
    });
    const execFn = mockExecFn({ 'git checkout "feat/foo"': "" });
    const execSafeFn = mockExecFn({ "git diff --name-only main...HEAD": "src/branch.ts\n" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const changedFiles = await resolveReviewChangedFiles("--branch feat/foo", pctx);

    expect(changedFiles).toEqual(["src/branch.ts"]);
    expect(execFn).toHaveBeenCalledWith('git checkout "feat/foo"', "/tmp");
    expect(execSafeFn).toHaveBeenCalledWith("git diff --name-only main...HEAD", "/tmp");
    expect(execSafeFn).not.toHaveBeenCalledWith("git diff --name-only HEAD~1...HEAD", "/tmp");
  });

  it("resolves changed files for the current branch without running setup commands", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({
      diffCmd: "git diff main...HEAD",
      prNumber: "17",
      setupCmds: [],
    });
    const execFn = mockExecFn({});
    const execSafeFn = mockExecFn({ "git diff --name-only main...HEAD": "src/current.ts\n" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn, execSafeFn });

    const changedFiles = await resolveReviewChangedFiles("", pctx);

    expect(changedFiles).toEqual(["src/current.ts"]);
    expect(execFn).not.toHaveBeenCalled();
    expect(execSafeFn).toHaveBeenCalledWith("git diff --name-only main...HEAD", "/tmp");
  });

  it("wires checkout → diff → standalone review → comment proposal and returns findings with isError on blocking findings", async () => {
    const execFn = mockExecFn({
      "gh pr checkout 5": "",
      "gh pr diff 5": "diff output here",
      "gh repo view": "owner/repo",
    });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: vi.fn(async () => undefined) } }),
    });

    const result = await runReview("5", pctx);

    expect(resolveDiffTarget).toHaveBeenCalledWith("/tmp", "5", pctx.execSafeFn);
    expect(execFn).toHaveBeenCalledWith("gh pr checkout 5", "/tmp");
    expect(execFn).toHaveBeenCalledWith("gh pr diff 5", "/tmp");
    expect(runStandaloneReviewPipeline).toHaveBeenCalledWith(
      "diff output here",
      expect.objectContaining({ cwd: "/tmp" }),
    );
    expect(proposeAndPostComments).toHaveBeenCalledWith(
      "Bug found in foo.ts",
      expect.objectContaining({ number: "5" }),
      expect.objectContaining({ cwd: "/tmp", ctx: pctx.ctx }),
    );
    expect(result.content[0]?.text).toBe("Bug found in foo.ts");
    expect(result.isError).toBe(true);
  });

  it("returns early with no-changes message when diff is empty", async () => {
    const execFn = mockExecFn({ "gh pr checkout 5": "" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(runReviewPipeline).mockClear();

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("No changes");
    expect(runStandaloneReviewPipeline).not.toHaveBeenCalled();
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });

  it("returns passed message when standalone review finds nothing", async () => {
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({ hasBlockingFindings: false, report: undefined });
    const execFn = mockExecFn({ "gh pr checkout 5": "", "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("passed");
    expect(result.isError).toBeUndefined();
  });

  it("returns advisory findings without marking the run as an error", async () => {
    vi.mocked(proposeAndPostComments).mockClear();
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({
      hasBlockingFindings: false,
      report: "## Architecture delta review\n\n### 1. Split the module",
    });
    const execFn = mockExecFn({ "gh pr checkout 5": "", "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("Architecture delta review");
    expect(result.isError).toBeUndefined();
    expect(proposeAndPostComments).not.toHaveBeenCalled();
  });

  it("calls ui.input in interactive mode and forwards answer to standalone review", async () => {
    const inputFn = vi.fn(async () => "look for SQL injection");
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({ hasBlockingFindings: false, report: undefined });

    const execFn = mockExecFn({ "gh pr checkout 5": "", "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: inputFn } }),
    });
    await runReview("5", pctx);

    expect(inputFn).toHaveBeenCalledWith("Additional instructions?", "Skip");
    expect(runStandaloneReviewPipeline).toHaveBeenCalledWith(
      "some diff",
      expect.objectContaining({ customPrompt: "look for SQL injection" }),
    );
  });

  it("passes no customPrompt to standalone review when user skips the prompt", async () => {
    const inputFn = vi.fn(async () => "");
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({ hasBlockingFindings: false, report: undefined });

    const execFn = mockExecFn({ "gh pr checkout 5": "", "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: inputFn } }),
    });
    await runReview("5", pctx);

    expect(inputFn).toHaveBeenCalled();
    const firstCall = vi.mocked(runStandaloneReviewPipeline).mock.calls[0];
    if (!firstCall) throw new Error("expected runStandaloneReviewPipeline to be called");
    expect(firstCall[1].customPrompt).toBeUndefined();
  });

  it("uses the strict review path when requested", async () => {
    vi.mocked(runReviewPipeline).mockClear();
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(proposeAndPostComments).mockClear();
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: false, findings: "Strict finding" });

    const execFn = mockExecFn({
      "gh pr checkout 5": "",
      "gh pr diff 5": "some diff",
      "gh repo view": "owner/repo",
    });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: vi.fn(async () => undefined) } }),
    });

    const result = await runReview("5", pctx, { strict: true });

    expect(runReviewPipeline).toHaveBeenCalledWith("some diff", expect.objectContaining({ cwd: "/tmp" }));
    expect(runStandaloneReviewPipeline).not.toHaveBeenCalled();
    expect(proposeAndPostComments).toHaveBeenCalledWith(
      "Strict finding",
      expect.objectContaining({ number: "5" }),
      expect.objectContaining({ cwd: "/tmp", ctx: pctx.ctx }),
    );
    expect(result.content[0]?.text).toBe("Strict finding");
    expect(result.isError).toBe(true);
  });
});
