import { emptyStage, type RunAgentFn, type StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { waitForChecksAndFix } from "./ci-wait.js";

/**
 * Build an execSafeFn that returns a sequence of responses for the
 * `--json bucket,name` query (one per call) and static responses for
 * `--watch`, `gh run list`, and `gh run view`. Every other command
 * returns the empty string.
 *
 * This lets each test script "CI state progresses from fail to pass
 * across N attempts" without hand-crafting a closure in every case.
 */
function scriptedExecSafeFn(opts: {
  bucketSequence: Array<Array<{ bucket: string; name: string }>>;
  runId?: string;
  logs?: string;
}) {
  const bucketResponses = [...opts.bucketSequence];
  return vi.fn(async (cmd: string) => {
    if (cmd.includes("--watch")) return "";
    if (cmd.includes("--json bucket,name")) {
      const next = bucketResponses.shift() ?? [];
      return JSON.stringify(next);
    }
    if (cmd.includes("gh run list")) return opts.runId ?? "";
    if (cmd.includes("gh run view") && cmd.includes("--log-failed")) return opts.logs ?? "";
    return "";
  });
}

function recordingRunAgent(): { runAgentFn: RunAgentFn; calls: Array<{ stageName?: string; task: string }> } {
  const calls: Array<{ stageName?: string; task: string }> = [];
  const runAgentFn: RunAgentFn = vi.fn(async (agent, task, opts) => {
    calls.push({ stageName: opts.stageName, task });
    return { ...emptyStage(opts.stageName ?? agent), status: "done" as const };
  });
  return { runAgentFn, calls };
}

describe("waitForChecksAndFix", () => {
  it("returns passed on the first wait and does not spawn the fix agent", async () => {
    const execSafeFn = scriptedExecSafeFn({
      bucketSequence: [[{ bucket: "pass", name: "build" }]],
    });
    const { runAgentFn, calls } = recordingRunAgent();
    const pctx = mockPipelineContext({ execSafeFn, runAgentFn });
    const stages: StageResult[] = [];

    const result = await waitForChecksAndFix(pctx, 7, "feat/issue-1", stages);

    expect(result).toEqual({ passed: true, attempts: 0, failedChecks: [] });
    expect(calls).toHaveLength(0);
  });

  it("spawns the implementor as ci-fix-1 when the first wait fails, then returns passed after re-wait", async () => {
    const execSafeFn = scriptedExecSafeFn({
      bucketSequence: [[{ bucket: "fail", name: "unit-tests" }], [{ bucket: "pass", name: "unit-tests" }]],
      runId: "999",
      logs: "fake CI log output",
    });
    const { runAgentFn, calls } = recordingRunAgent();
    const pctx = mockPipelineContext({ execSafeFn, runAgentFn });
    const stages: StageResult[] = [];

    const result = await waitForChecksAndFix(pctx, 7, "feat/issue-2", stages);

    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stageName).toBe("ci-fix-1");
    expect(calls[0]?.task).toContain("unit-tests");
    expect(calls[0]?.task).toContain("fake CI log output");
    expect(calls[0]?.task).toContain("feat/issue-2");
    // Stage entry added by the chain-builder for the fix phase.
    expect(stages.some((s) => s.name === "ci-fix-1")).toBe(true);
  });

  it("gives up with ci-failed-after-max-attempts when fixes keep failing past the cap", async () => {
    // 4 wait calls all returning fail; cap is 3 so we attempt 3 fixes then stop.
    const execSafeFn = scriptedExecSafeFn({
      bucketSequence: [
        [{ bucket: "fail", name: "unit-tests" }],
        [{ bucket: "fail", name: "unit-tests" }],
        [{ bucket: "fail", name: "unit-tests" }],
        [{ bucket: "fail", name: "unit-tests" }],
      ],
      runId: "999",
      logs: "fake logs",
    });
    const { runAgentFn, calls } = recordingRunAgent();
    const pctx = mockPipelineContext({ execSafeFn, runAgentFn });

    const result = await waitForChecksAndFix(pctx, 7, "feat/issue-3", []);

    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.reason).toBe("ci-failed-after-max-attempts");
    expect(result.failedChecks).toEqual(["unit-tests"]);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.stageName)).toEqual(["ci-fix-1", "ci-fix-2", "ci-fix-3"]);
  });

  it("bails out with no-logs when the failed-run log fetch comes back empty", async () => {
    const execSafeFn = scriptedExecSafeFn({
      bucketSequence: [[{ bucket: "fail", name: "unit-tests" }]],
      runId: "", // fetchFailedCiLogs short-circuits when no run id found
    });
    const { runAgentFn, calls } = recordingRunAgent();
    const pctx = mockPipelineContext({ execSafeFn, runAgentFn });

    const result = await waitForChecksAndFix(pctx, 7, "feat/issue-4", []);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("no-logs");
    expect(result.attempts).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("bails out with unknown-bucket when the rollup has no fail entries but waitForChecks says not passed", async () => {
    // Simulates the JSON-parse failure path inside waitForChecks: empty
    // failed list AND passed:false means gh returned something weird.
    const execSafeFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("--watch")) return "";
      if (cmd.includes("--json bucket,name")) return "not json";
      return "";
    });
    const { runAgentFn, calls } = recordingRunAgent();
    const pctx = mockPipelineContext({ execSafeFn, runAgentFn });

    const result = await waitForChecksAndFix(pctx, 7, "feat/issue-5", []);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("unknown-bucket");
    expect(result.failedChecks).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
