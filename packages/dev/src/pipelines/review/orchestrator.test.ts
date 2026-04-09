import { emptyStage } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReviewPipeline } from "./orchestrator.js";

// Mock signals module
let signals: Record<string, string> = {};

vi.mock("@callumvass/forgeflow-shared/pipeline", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cleanSignal: vi.fn((_cwd: string, name: string) => {
      delete signals[name];
    }),
    signalExists: vi.fn((_cwd: string, name: string) => name in signals),
    readSignal: vi.fn((_cwd: string, name: string) => signals[name] ?? null),
  };
});

function setSignal(name: string, value: string) {
  signals[name] = value;
}

function clearSignals() {
  signals = {};
}

function mockRunAgent(sideEffects: Array<() => void> = []) {
  let callIndex = 0;
  return vi.fn(async () => {
    const effect = sideEffects[callIndex];
    if (effect) effect();
    callIndex++;
    return { ...emptyStage("mock"), output: "agent output", status: "done" as const };
  });
}

describe("runReviewPipeline", () => {
  const baseOpts = (runAgentFn: ReturnType<typeof mockRunAgent>) => ({
    ...mockPipelineContext({ cwd: "/tmp", agentsDir: "/tmp/agents", runAgentFn }),
    stages: [],
    pipeline: "review",
  });

  beforeEach(() => {
    clearSignals();
  });

  it("returns passed: true when code-reviewer produces no findings signal", async () => {
    // After reviewer runs, no findings signal exists
    const runAgentFn = mockRunAgent([]);

    const result = await runReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toEqual({ passed: true });
    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(runAgentFn).toHaveBeenCalledWith(
      "code-reviewer",
      expect.stringContaining("diff content"),
      expect.any(Object),
    );
  });

  it("returns passed: true when review-judge filters all findings", async () => {
    // Reviewer sets findings, then judge clears them
    const runAgentFn = mockRunAgent([
      () => setSignal("findings", "some findings"),
      () => clearSignals(), // judge removes findings
    ]);

    const result = await runReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toEqual({ passed: true });
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(runAgentFn).toHaveBeenNthCalledWith(
      2,
      "review-judge",
      expect.stringContaining("some findings"),
      expect.any(Object),
    );
  });

  it("returns passed: false with findings when validated findings survive both stages", async () => {
    // Reviewer sets findings, judge updates but keeps them
    const runAgentFn = mockRunAgent([
      () => setSignal("findings", "initial findings"),
      () => setSignal("findings", "validated findings"),
    ]);

    const result = await runReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toEqual({ passed: false, findings: "validated findings" });
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("includes custom prompt as extra instructions when provided", async () => {
    const runAgentFn = mockRunAgent([]);

    await runReviewPipeline("diff content", { ...baseOpts(runAgentFn), customPrompt: "Check for SQL injection" });

    expect(runAgentFn).toHaveBeenCalledWith(
      "code-reviewer",
      expect.stringContaining("Check for SQL injection"),
      expect.any(Object),
    );
  });
});
