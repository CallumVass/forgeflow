import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd/document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prd/document.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => true),
  };
});

vi.mock("../prd/qa-loop.js", () => ({
  runQaLoop: vi.fn(async () => ({ accepted: true })),
}));

vi.mock("../prd/bootstrap.js", () => ({
  promptBootstrapPrd: vi.fn(async () => false),
}));

import { promptBootstrapPrd } from "../prd/bootstrap.js";
import { prdExists } from "../prd/document.js";
import { runQaLoop } from "../prd/qa-loop.js";
import { runPrdQa } from "./prd-qa.js";

describe("runPrdQa", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReset();
    vi.mocked(prdExists).mockReturnValue(true);
    vi.mocked(promptBootstrapPrd).mockReset();
    vi.mocked(promptBootstrapPrd).mockResolvedValue(false);
    vi.mocked(runQaLoop).mockReset();
    vi.mocked(runQaLoop).mockResolvedValue({ accepted: true });
  });

  it("delegates to runQaLoop and returns success when accepted", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });

    const pctx = mockPipelineContext();
    const result = await runPrdQa(10, pctx);

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("chosen high-level technical direction"),
        pipeline: "prd-qa",
        maxIterations: 10,
        uiReviewMode: "final",
        finalReviewTitle: "PRD refinement complete — Review PRD",
      }),
    );
    expect(result.content[0]?.text).toContain("make any final adjustments");
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

  it("bootstraps an initial PRD interactively when PRD.md is missing", async () => {
    vi.mocked(prdExists).mockReturnValueOnce(false).mockReturnValue(true);
    vi.mocked(promptBootstrapPrd).mockResolvedValue(true);
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });

    const pctx = mockPipelineContext({
      ctx: mockForgeflowContext({ hasUI: true }),
    });
    const result = await runPrdQa(10, pctx);

    expect(promptBootstrapPrd).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain("refinement complete");
  });

  it("returns a PRD.md not found result and does not invoke runQaLoop when bootstrap is unavailable", async () => {
    vi.mocked(prdExists).mockReturnValue(false);
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockClear();

    const pctx = mockPipelineContext();
    const result = await runPrdQa(10, pctx);

    expect(result.content[0]?.text).toContain("PRD.md not found.");
    expect(promptBootstrapPrd).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).not.toHaveBeenCalled();
  });
});
