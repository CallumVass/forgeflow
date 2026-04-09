import { mockExecFn, mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("./diff.js", () => ({
  resolveDiffTarget: vi.fn(async () => ({ diffCmd: "gh pr diff 5", prNumber: "5" })),
}));

vi.mock("./orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: false, findings: "Bug found in foo.ts" })),
}));

vi.mock("./comments.js", () => ({
  proposeAndPostComments: vi.fn(async () => {}),
}));

import { proposeAndPostComments } from "./comments.js";
import { resolveDiffTarget } from "./diff.js";
import { runReview } from "./index.js";
import { runReviewPipeline } from "./orchestrator.js";

describe("runReview composition root", () => {
  it("wires diff → orchestrator → comments and returns findings with isError on failure", async () => {
    const execFn = mockExecFn({ "gh pr diff 5": "diff output here", "gh repo view": "owner/repo" });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: vi.fn(async () => undefined) } }),
    });

    const result = await runReview("5", pctx);

    expect(resolveDiffTarget).toHaveBeenCalledWith("/tmp", "5", pctx.execSafeFn);
    expect(execFn).toHaveBeenCalledWith("gh pr diff 5", "/tmp");
    expect(runReviewPipeline).toHaveBeenCalledWith("diff output here", expect.objectContaining({ cwd: "/tmp" }));
    expect(proposeAndPostComments).toHaveBeenCalledWith(
      "Bug found in foo.ts",
      expect.objectContaining({ number: "5" }),
      expect.objectContaining({ cwd: "/tmp", ctx: pctx.ctx }),
    );
    expect(result.content[0]?.text).toBe("Bug found in foo.ts");
    expect(result.isError).toBe(true);
  });

  it("returns early with no-changes message when diff is empty", async () => {
    const execFn = mockExecFn({});
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });
    vi.mocked(runReviewPipeline).mockClear();

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("No changes");
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });

  it("returns passed message when review pipeline passes", async () => {
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: true });
    const execFn = mockExecFn({ "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({ cwd: "/tmp", execFn });

    const result = await runReview("5", pctx);

    expect(result.content[0]?.text).toContain("passed");
    expect(result.isError).toBeUndefined();
  });

  it("calls ui.input in interactive mode and forwards answer to runReviewPipeline", async () => {
    const inputFn = vi.fn(async () => "look for SQL injection");
    vi.mocked(runReviewPipeline).mockClear();
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: true });

    const execFn = mockExecFn({ "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: inputFn } }),
    });
    await runReview("5", pctx);

    expect(inputFn).toHaveBeenCalledWith("Additional instructions?", "Skip");
    expect(runReviewPipeline).toHaveBeenCalledWith(
      "some diff",
      expect.objectContaining({ customPrompt: "look for SQL injection" }),
    );
  });

  it("passes no customPrompt to runReviewPipeline when user skips the prompt", async () => {
    const inputFn = vi.fn(async () => "");
    vi.mocked(runReviewPipeline).mockClear();
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: true });

    const execFn = mockExecFn({ "gh pr diff 5": "some diff" });
    const pctx = mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp", ui: { input: inputFn } }),
    });
    await runReview("5", pctx);

    expect(inputFn).toHaveBeenCalled();
    const firstCall = vi.mocked(runReviewPipeline).mock.calls[0];
    if (!firstCall) throw new Error("expected runReviewPipeline to be called");
    expect(firstCall[1].customPrompt).toBeUndefined();
  });
});
