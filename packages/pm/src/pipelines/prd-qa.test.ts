import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd-document.js", () => ({
  prdExists: vi.fn(() => true),
}));

vi.mock("./qa-loop.js", () => ({
  runQaLoop: vi.fn(async () => ({ accepted: true })),
}));

import { prdExists } from "../prd-document.js";
import { runPrdQa } from "./prd-qa.js";
import { runQaLoop } from "./qa-loop.js";

describe("runPrdQa", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReturnValue(true);
  });

  it("delegates to runQaLoop and returns success when accepted", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });

    const pctx = mockPipelineContext();
    const result = await runPrdQa(10, pctx);

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("Review PRD.md for completeness"),
        pipeline: "prd-qa",
        maxIterations: 10,
      }),
    );
    expect(result.content[0]?.text).toContain("refinement complete");
    expect(result.isError).toBeUndefined();
  });

  it("returns error result when runQaLoop returns an error", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: false, error: { text: "Critic failed." } });

    const pctx = mockPipelineContext();
    const result = await runPrdQa(10, pctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Critic failed.");
  });

  it("returns a PRD.md not found result and does not invoke runQaLoop when PRD is missing", async () => {
    vi.mocked(prdExists).mockReturnValue(false);
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockClear();

    const pctx = mockPipelineContext();
    const result = await runPrdQa(10, pctx);

    expect(result.content[0]?.text).toContain("PRD.md not found.");
    expect(mockedRunQaLoop).not.toHaveBeenCalled();
  });
});
