import type { StageResult } from "@callumvass/forgeflow-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReviewPipeline } from "./review-orchestrator.js";

// Mock signals module
vi.mock("@callumvass/forgeflow-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared")>();
  let signals: Record<string, string> = {};
  return {
    ...actual,
    cleanSignal: vi.fn((_cwd: string, name: string) => {
      delete signals[name];
    }),
    signalExists: vi.fn((_cwd: string, name: string) => name in signals),
    readSignal: vi.fn((_cwd: string, name: string) => signals[name] ?? null),
    // Allow tests to control the signal state
    __setSignal: (name: string, value: string) => {
      signals[name] = value;
    },
    __clearSignals: () => {
      signals = {};
    },
  };
});

// biome-ignore lint/suspicious/noExplicitAny: test helper access
const shared = (await import("@callumvass/forgeflow-shared")) as any;

function mockRunAgent(sideEffects: Array<() => void> = []) {
  let callIndex = 0;
  return vi.fn(async () => {
    const effect = sideEffects[callIndex];
    if (effect) effect();
    callIndex++;
    return { output: "agent output", status: "done" };
  });
}

describe("runReviewPipeline", () => {
  const baseOpts = () => ({
    cwd: "/tmp",
    signal: AbortSignal.timeout(5000),
    stages: [] as StageResult[],
  });

  beforeEach(() => {
    shared.__clearSignals();
  });

  it("returns passed: true when code-reviewer produces no findings signal", async () => {
    // After reviewer runs, no findings signal exists
    const runAgentFn = mockRunAgent([]);

    const result = await runReviewPipeline("diff content", {
      ...baseOpts(),
      runAgentFn,
    });

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
      () => shared.__setSignal("findings", "some findings"),
      () => shared.__clearSignals(), // judge removes findings
    ]);

    const result = await runReviewPipeline("diff content", {
      ...baseOpts(),
      runAgentFn,
    });

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
      () => shared.__setSignal("findings", "initial findings"),
      () => shared.__setSignal("findings", "validated findings"),
    ]);

    const result = await runReviewPipeline("diff content", {
      ...baseOpts(),
      runAgentFn,
    });

    expect(result).toEqual({ passed: false, findings: "validated findings" });
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("includes custom prompt as extra instructions when provided", async () => {
    const runAgentFn = mockRunAgent([]);

    await runReviewPipeline("diff content", {
      ...baseOpts(),
      customPrompt: "Check for SQL injection",
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledWith(
      "code-reviewer",
      expect.stringContaining("Check for SQL injection"),
      expect.any(Object),
    );
  });
});
