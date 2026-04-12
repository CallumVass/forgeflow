import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("./diff.js", () => ({
  resolveDiffTarget: vi.fn(async () => ({ kind: "pr", prNumber: "5" })),
}));

vi.mock("@callumvass/forgeflow-shared/repository", () => ({
  resolveReviewChangedFiles: vi.fn(async () => ["src/foo.ts", "src/bar.ts"]),
  readReviewDiff: vi.fn(async () => "diff output here"),
  readRepositoryNameWithOwner: vi.fn(async () => "owner/repo"),
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

import {
  readRepositoryNameWithOwner,
  readReviewDiff,
  resolveReviewChangedFiles as resolveRepositoryReviewChangedFiles,
} from "@callumvass/forgeflow-shared/repository";
import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { resolveReviewChangedFiles, runReview } from "./index.js";
import { runReviewPipeline, runStandaloneReviewPipeline } from "./orchestrator.js";

describe("runReview composition root", () => {
  it("delegates changed-file discovery for PR targets to the shared repository boundary", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({ kind: "pr", prNumber: "5" });
    vi.mocked(resolveRepositoryReviewChangedFiles).mockResolvedValueOnce(["src/foo.ts", "src/bar.ts"]);
    const pctx = mockPipelineContext({ cwd: "/tmp" });

    const changedFiles = await resolveReviewChangedFiles("5", pctx);

    expect(changedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(resolveDiffTarget).toHaveBeenCalledWith("/tmp", "5", pctx.execSafeFn);
    expect(resolveRepositoryReviewChangedFiles).toHaveBeenCalledWith({ kind: "pr", prNumber: "5" }, pctx);
  });

  it("delegates changed-file discovery for branch targets to the shared repository boundary", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({ kind: "branch", branch: "feat/foo" });
    vi.mocked(resolveRepositoryReviewChangedFiles).mockResolvedValueOnce(["src/branch.ts"]);
    const pctx = mockPipelineContext({ cwd: "/tmp" });

    const changedFiles = await resolveReviewChangedFiles("--branch feat/foo", pctx);

    expect(changedFiles).toEqual(["src/branch.ts"]);
    expect(resolveRepositoryReviewChangedFiles).toHaveBeenCalledWith({ kind: "branch", branch: "feat/foo" }, pctx);
  });

  it("wires repository diff + standalone review + comment proposal and returns findings with isError on blocking findings", async () => {
    vi.mocked(resolveDiffTarget).mockResolvedValueOnce({ kind: "pr", prNumber: "5" });
    vi.mocked(resolveRepositoryReviewChangedFiles).mockResolvedValueOnce(["src/foo.ts", "src/bar.ts"]);
    vi.mocked(readReviewDiff).mockResolvedValueOnce("diff output here");
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: vi.fn(async () => undefined) } }),
    });

    const result = await runReview("5", pctx);

    expect(resolveDiffTarget).toHaveBeenCalledWith("/tmp", "5", pctx.execSafeFn);
    expect(readReviewDiff).toHaveBeenCalledWith({ kind: "pr", prNumber: "5" }, { cwd: "/tmp", execFn: pctx.execFn });
    expect(runStandaloneReviewPipeline).toHaveBeenCalledWith(
      "diff output here",
      expect.objectContaining({ cwd: "/tmp" }),
    );
    expect(readRepositoryNameWithOwner).toHaveBeenCalledWith({ cwd: "/tmp", execFn: pctx.execFn });
    expect(proposeAndPostComments).toHaveBeenCalledWith(
      "Bug found in foo.ts",
      expect.objectContaining({ number: "5", repo: "owner/repo" }),
      expect.objectContaining({ cwd: "/tmp", ctx: pctx.ctx }),
    );
    expect(result.content[0]?.text).toBe("Bug found in foo.ts");
    expect(result.isError).toBe(true);
  });

  it("returns early with no-changes message when the shared repository diff is empty", async () => {
    vi.mocked(readReviewDiff).mockResolvedValueOnce("");
    const pctx = mockPipelineContext({ cwd: "/tmp" });
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(runReviewPipeline).mockClear();

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("No changes");
    expect(runStandaloneReviewPipeline).not.toHaveBeenCalled();
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });

  it("returns passed message when standalone review finds nothing", async () => {
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({ hasBlockingFindings: false, report: undefined });
    vi.mocked(readReviewDiff).mockResolvedValueOnce("some diff");
    const pctx = mockPipelineContext({ cwd: "/tmp" });

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
    vi.mocked(readReviewDiff).mockResolvedValueOnce("some diff");
    const pctx = mockPipelineContext({ cwd: "/tmp" });

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("Architecture delta review");
    expect(result.isError).toBeUndefined();
    expect(proposeAndPostComments).not.toHaveBeenCalled();
  });

  it("calls ui.input in interactive mode and forwards the answer to standalone review", async () => {
    const inputFn = vi.fn(async () => "look for SQL injection");
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({ hasBlockingFindings: false, report: undefined });
    vi.mocked(readReviewDiff).mockResolvedValueOnce("some diff");

    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: inputFn } }),
    });
    await runReview("5", pctx);

    expect(inputFn).toHaveBeenCalledWith("Additional instructions?", "Skip");
    expect(runStandaloneReviewPipeline).toHaveBeenCalledWith(
      "some diff",
      expect.objectContaining({ customPrompt: "look for SQL injection" }),
    );
  });

  it("passes no customPrompt to standalone review when the user skips the prompt", async () => {
    const inputFn = vi.fn(async () => "");
    vi.mocked(runStandaloneReviewPipeline).mockClear();
    vi.mocked(runStandaloneReviewPipeline).mockResolvedValueOnce({ hasBlockingFindings: false, report: undefined });
    vi.mocked(readReviewDiff).mockResolvedValueOnce("some diff");

    const pctx = mockPipelineContext({
      cwd: "/tmp",
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
    vi.mocked(readReviewDiff).mockResolvedValueOnce("some diff");

    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: vi.fn(async () => undefined) } }),
    });

    const result = await runReview("5", pctx, { strict: true });

    expect(runReviewPipeline).toHaveBeenCalledWith("some diff", expect.objectContaining({ cwd: "/tmp" }));
    expect(runStandaloneReviewPipeline).not.toHaveBeenCalled();
    expect(readRepositoryNameWithOwner).toHaveBeenCalledWith({ cwd: "/tmp", execFn: pctx.execFn });
    expect(proposeAndPostComments).toHaveBeenCalledWith(
      "Strict finding",
      expect.objectContaining({ number: "5", repo: "owner/repo" }),
      expect.objectContaining({ cwd: "/tmp", ctx: pctx.ctx }),
    );
    expect(result.content[0]?.text).toBe("Strict finding");
    expect(result.isError).toBe(true);
  });
});
