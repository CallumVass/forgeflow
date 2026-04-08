import { mockForgeflowContext, mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd-document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prd-document.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => true),
    promptEditPrd: vi.fn(async () => null),
  };
});

vi.mock("./qa-loop.js", () => ({
  runQaLoop: vi.fn(async () => ({ accepted: true })),
}));

import { prdExists, promptEditPrd } from "../prd-document.js";
import { runContinue } from "./continue.js";
import { runQaLoop } from "./qa-loop.js";

describe("runContinue", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReturnValue(true);
    vi.mocked(promptEditPrd).mockResolvedValue(null);
    vi.mocked(runQaLoop).mockClear();
    vi.mocked(runQaLoop).mockResolvedValue({ accepted: true });
  });

  it("calls runQaLoop in Phase 2 and proceeds to issue creation on acceptance", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });
    const runAgentFn = mockRunAgent("done");
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runContinue("focus on auth", 5, pctx);

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("focus on the ## Next section"),
        pipeline: "continue",
      }),
    );
    // Phase 1 (prd-architect) and Phase 3 (gh-issue-creator) both flow through pctx.runAgentFn
    const agentCalls = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agentCalls).toEqual(["prd-architect", "gh-issue-creator"]);
    // Pipeline should complete (Phase 3 runs)
    expect(result.content[0]?.text).toContain("complete");
    expect(result.isError).toBeUndefined();
  });

  it("returns a PRD.md not found result and runs no agents when PRD is missing", async () => {
    vi.mocked(prdExists).mockReturnValue(false);
    const runAgentFn = mockRunAgent("should not be called");
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runContinue("anything", 5, pctx);

    expect(result.content[0]?.text).toContain("PRD.md not found.");
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(vi.mocked(runQaLoop)).not.toHaveBeenCalled();
  });

  it("invokes promptEditPrd once after Phase 1 when ctx.hasUI is true", async () => {
    vi.mocked(runQaLoop).mockResolvedValue({ accepted: true });
    const select = vi.fn(async () => "Continue to QA");
    const ctx = mockForgeflowContext({ hasUI: true, ui: { select } });
    const runAgentFn = mockRunAgent("done");
    const pctx = mockPipelineContext({ runAgentFn, ctx });

    await runContinue("focus", 5, pctx);

    expect(vi.mocked(promptEditPrd)).toHaveBeenCalledOnce();
    expect(vi.mocked(promptEditPrd)).toHaveBeenCalledWith(
      expect.any(Object),
      "Review updated PRD (Done/Next structure)",
    );
  });
});
