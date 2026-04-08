import { beforeEach, describe, expect, it, vi } from "vitest";
import { type QaLoopOptions, runQaLoop } from "./qa-loop.js";

vi.mock("../prd-document.js", () => ({
  promptEditPrd: vi.fn(async () => null),
}));

import { emptyStage, type ForgeflowContext } from "@callumvass/forgeflow-shared/pipeline";
import { mockForgeflowContext, mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { promptEditPrd } from "../prd-document.js";

function mockCtx(
  opts: { hasUI?: boolean; editorResult?: string | undefined; selectResult?: string | undefined } = {},
): ForgeflowContext {
  return mockForgeflowContext({
    hasUI: opts.hasUI ?? true,
    ui: {
      editor: vi.fn(async () => opts.editorResult ?? undefined),
      select: vi.fn(async () => opts.selectResult ?? undefined),
      input: vi.fn(async () => undefined),
    },
  });
}

function baseOpts(overrides: Partial<QaLoopOptions> = {}): QaLoopOptions {
  const pctx = mockPipelineContext({
    cwd: "/tmp/test",
    agentsDir: "/agents",
    runAgentFn: overrides.runAgentFn ?? mockRunAgent(),
    ctx: overrides.ctx ?? mockCtx(),
  });
  return {
    ...pctx,
    stages: [],
    pipeline: "test",
    maxIterations: 10,
    criticPrompt: "Review PRD.md",
    signalExistsFn: vi.fn(() => false),
    ...overrides,
  };
}

describe("runQaLoop", () => {
  beforeEach(() => {
    vi.mocked(promptEditPrd).mockClear();
    vi.mocked(promptEditPrd).mockResolvedValue(null);
  });

  it("returns accepted when critic approves on first pass (no QUESTIONS.md)", async () => {
    const runAgentFn = mockRunAgent("PRD looks good");
    const signalExistsFn = vi.fn(() => false);

    const result = await runQaLoop(baseOpts({ runAgentFn, signalExistsFn }));

    expect(result.accepted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(runAgentFn).toHaveBeenCalledOnce(); // only critic, no architect/integrator
    expect(runAgentFn.mock.calls).toHaveLength(1);
    expect(runAgentFn.mock.calls[0]).toEqual(expect.arrayContaining(["prd-critic"]));
  });

  it("runs full iteration (critic → architect → integrator) and returns accepted on user approval", async () => {
    const runAgentFn = mockRunAgent();
    // First call: signalExists returns true (QUESTIONS.md exists), second call: false (loop ends)
    const signalExistsFn = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const ctx = mockCtx({ selectResult: "Accept PRD" });

    const result = await runQaLoop(baseOpts({ runAgentFn, signalExistsFn, ctx }));

    expect(result.accepted).toBe(true);
    // critic → architect → integrator in iteration 1, then user accepts
    expect(runAgentFn).toHaveBeenCalledTimes(3);
    const calls = runAgentFn.mock.calls as unknown[][];
    expect(calls.map((c) => c[0])).toEqual(["prd-critic", "prd-architect", "prd-integrator"]);
    expect(vi.mocked(promptEditPrd)).toHaveBeenCalledOnce();
    expect(ctx.ui.select).toHaveBeenCalledOnce();
  });

  it("returns error when critic fails and no QUESTIONS.md exists", async () => {
    const runAgentFn = mockRunAgent("", "failed");
    // Override the mock to include specific stderr for this test
    runAgentFn.mockImplementation(async () => ({
      ...emptyStage("mock"),
      status: "failed" as const,
      exitCode: 1,
      stderr: "agent crashed hard",
    }));
    const signalExistsFn = vi.fn(() => false);

    const result = await runQaLoop(baseOpts({ runAgentFn, signalExistsFn }));

    expect(result.accepted).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.text).toContain("Critic failed");
    expect(result.error?.text).toContain("agent crashed hard");
  });

  it("returns not accepted when iteration cap is reached", async () => {
    const runAgentFn = mockRunAgent();
    const signalExistsFn = vi.fn(() => true); // always creates QUESTIONS.md
    const ctx = mockCtx({ selectResult: "Continue refining" });

    const result = await runQaLoop(baseOpts({ runAgentFn, signalExistsFn, ctx, maxIterations: 2 }));

    expect(result.accepted).toBe(false);
    expect(result.error).toBeUndefined();
    // 2 iterations × 3 agents = 6 calls
    expect(runAgentFn).toHaveBeenCalledTimes(6);
  });

  it("invokes promptEditPrd once per QA iteration when ctx.hasUI is true", async () => {
    const runAgentFn = mockRunAgent();
    // iteration 1: questions exist; user continues → iteration 2: questions exist; loop hits cap
    const signalExistsFn = vi.fn(() => true);
    const ctx = mockCtx({ editorResult: "# Updated PRD", selectResult: "Continue refining" });

    await runQaLoop(baseOpts({ runAgentFn, signalExistsFn, ctx, maxIterations: 2 }));

    expect(vi.mocked(promptEditPrd)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(promptEditPrd)).toHaveBeenNthCalledWith(1, expect.any(Object), "QA iteration 1 — Review PRD");
    expect(vi.mocked(promptEditPrd)).toHaveBeenNthCalledWith(2, expect.any(Object), "QA iteration 2 — Review PRD");
  });

  it("does not invoke promptEditPrd or editor/select when ctx.hasUI is false", async () => {
    const runAgentFn = mockRunAgent();
    // iteration 1: questions exist, iteration 2: no questions
    const signalExistsFn = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const ctx = mockCtx({ hasUI: false });

    const result = await runQaLoop(baseOpts({ runAgentFn, signalExistsFn, ctx }));

    expect(result.accepted).toBe(true);
    expect(vi.mocked(promptEditPrd)).not.toHaveBeenCalled();
    expect(ctx.ui.editor).not.toHaveBeenCalled();
    expect(ctx.ui.select).not.toHaveBeenCalled();
    // iteration 1: critic + architect + integrator, iteration 2: critic
    expect(runAgentFn).toHaveBeenCalledTimes(4);
  });

  it("passes criticPrompt verbatim to the prd-critic agent call", async () => {
    const runAgentFn = mockRunAgent();
    const signalExistsFn = vi.fn(() => false);
    const customPrompt = "Focus on the ## Next section specifically";

    await runQaLoop(baseOpts({ runAgentFn, signalExistsFn, criticPrompt: customPrompt }));

    const calls = runAgentFn.mock.calls as unknown[][];
    expect(calls[0]?.[0]).toBe("prd-critic");
    expect(calls[0]?.[1]).toBe(customPrompt);
  });
});
