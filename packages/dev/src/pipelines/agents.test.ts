import { mockPipelineContext } from "@callumvass/forgeflow-shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("@callumvass/forgeflow-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared")>();
  return {
    ...actual,
    exec: vi.fn(async () => "diff content"),
    runAgent: vi.fn(async () => ({ output: "", status: "done" })),
  };
});

vi.mock("./review-orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: true })),
}));

import { exec } from "@callumvass/forgeflow-shared";
import { reviewAndFix } from "./agents.js";
import { runReviewPipeline } from "./review-orchestrator.js";

describe("reviewAndFix", () => {
  it("imports from review-orchestrator (not review.ts) and calls runReviewPipeline", async () => {
    const pctx = mockPipelineContext({ cwd: "/tmp" });
    await reviewAndFix(pctx, []);

    expect(exec).toHaveBeenCalledWith("git diff main...HEAD", "/tmp");
    expect(runReviewPipeline).toHaveBeenCalledWith("diff content", expect.objectContaining({ cwd: "/tmp" }));
  });

  it("skips review pipeline when diff is empty", async () => {
    vi.mocked(runReviewPipeline).mockClear();
    vi.mocked(exec).mockResolvedValueOnce("");
    const pctx = mockPipelineContext({ cwd: "/tmp" });
    await reviewAndFix(pctx, []);

    expect(runReviewPipeline).not.toHaveBeenCalled();
  });
});
