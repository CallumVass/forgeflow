import { mockForgeflowContext } from "@callumvass/forgeflow-shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("./review-diff.js", () => ({
  resolveDiffTarget: vi.fn(async () => ({ diffCmd: "gh pr diff 5", prNumber: "5" })),
}));

vi.mock("./review-orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: false, findings: "Bug found in foo.ts" })),
}));

vi.mock("./review-comments.js", () => ({
  proposeAndPostComments: vi.fn(async () => {}),
}));

vi.mock("@callumvass/forgeflow-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared")>();
  return {
    ...actual,
    exec: vi.fn(async () => "diff output here"),
  };
});

import { exec } from "@callumvass/forgeflow-shared";
import { runReview } from "./review.js";
import { proposeAndPostComments } from "./review-comments.js";
import { resolveDiffTarget } from "./review-diff.js";
import { runReviewPipeline } from "./review-orchestrator.js";

describe("runReview composition root", () => {
  it("wires diff → orchestrator → comments and returns findings with isError on failure", async () => {
    const ctx = mockForgeflowContext({ hasUI: true, ui: { input: vi.fn(async () => undefined) } });
    const result = await runReview("/tmp", "5", AbortSignal.timeout(5000), undefined, ctx);

    expect(resolveDiffTarget).toHaveBeenCalledWith("/tmp", "5");
    expect(exec).toHaveBeenCalledWith("gh pr diff 5", "/tmp");
    expect(runReviewPipeline).toHaveBeenCalledWith("diff output here", expect.objectContaining({ cwd: "/tmp" }));
    expect(proposeAndPostComments).toHaveBeenCalledWith(
      "Bug found in foo.ts",
      expect.objectContaining({ number: "5" }),
      expect.objectContaining({ cwd: "/tmp", ctx }),
    );
    expect(result.content[0]?.text).toBe("Bug found in foo.ts");
    expect(result.isError).toBe(true);
  });

  it("returns early with no-changes message when diff is empty", async () => {
    vi.mocked(exec).mockResolvedValueOnce("");
    const ctx = mockForgeflowContext();
    const result = await runReview("/tmp", "5", AbortSignal.timeout(5000), undefined, ctx);

    expect(result.content[0]?.text).toContain("No changes");
    expect(runReviewPipeline).not.toHaveBeenCalledTimes(2); // not called again
  });

  it("returns passed message when review pipeline passes", async () => {
    vi.mocked(exec).mockResolvedValueOnce("some diff");
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: true });
    const ctx = mockForgeflowContext();
    const result = await runReview("/tmp", "5", AbortSignal.timeout(5000), undefined, ctx);

    expect(result.content[0]?.text).toContain("passed");
    expect(result.isError).toBeUndefined();
  });
});

describe("no circular imports", () => {
  it("agents.ts does not import from review.ts", async () => {
    const fs = await import("node:fs");
    const agentsSource = fs.readFileSync(
      new URL("./agents.ts", import.meta.url).pathname.replace("/agents.ts", "/agents.ts"),
      "utf-8",
    );
    expect(agentsSource).not.toContain('from "./review.js"');
    expect(agentsSource).not.toContain("from './review.js'");
  });
});
