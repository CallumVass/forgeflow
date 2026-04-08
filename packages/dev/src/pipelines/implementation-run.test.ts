import { mockExecFn, mockPipelineContext, mockRunAgent, sequencedRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { makeGitHubResolvedIssue } from "../utils/issue-tracker.fixtures.js";
import { runImplementation } from "./implementation-run.js";

// `reviewAndFix` / `runImplementorPhase` poke at filesystem-backed signals.
// Stub them so tests only observe the runAgentFn / stages boundary.
vi.mock("@callumvass/forgeflow-shared/pipeline", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cleanSignal: vi.fn(),
    signalExists: vi.fn(() => false),
    readSignal: vi.fn(() => null),
  };
});

const resolved = makeGitHubResolvedIssue();

function emptyDiffExec() {
  return mockExecFn({ "git diff": "" });
}

describe("runImplementation", () => {
  it("fresh run returns completed with stages planner, architecture-reviewer, implementor, refactorer in order", async () => {
    // planner → architecture-reviewer → implementor → refactorer
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Do stuff" },
      { output: "No architectural recommendations" },
      { output: "implemented" },
      { output: "refactored" },
    ]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: emptyDiffExec() });

    const outcome = await runImplementation(
      {
        issueContext: "Issue #42: Test issue\n\nIssue body",
        resolved,
        flags: { skipPlan: false, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("completed");
    const names = outcome.stages.map((s) => s.name);
    expect(names).toEqual(["planner", "architecture-reviewer", "implementor", "refactorer"]);
  });

  it("skipPlan/skipReview flags drop planner+architecture-reviewer and prevent review phase from running", async () => {
    // skipPlan: only implementor + refactorer should run → 2 calls
    const runAgentFn = sequencedRunAgent([{ output: "implemented" }, { output: "refactored" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: emptyDiffExec() });

    const outcome = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("completed");
    const names = outcome.stages.map((s) => s.name);
    expect(names).not.toContain("planner");
    expect(names).not.toContain("architecture-reviewer");
    // Review phase artefacts must not appear.
    expect(names).not.toContain("code-reviewer");
    expect(names).not.toContain("fix-findings");
    // Only implementor + refactorer
    const agents = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agents).toEqual(["implementor", "refactorer"]);
  });

  it("cancelled + blocked outcomes: cancelled returns early; blocked bubbles reason with no refactor/review", async () => {
    // --- Cancelled path: interactive + select returns "Cancel" → runPlanning cancels.
    const cancelAgent = sequencedRunAgent([{ output: "## Plan" }, { output: "No notes" }]);
    const cancelPctx = mockPipelineContext({
      cwd: "/tmp",
      runAgentFn: cancelAgent,
      execFn: emptyDiffExec(),
      ctx: {
        hasUI: true,
        cwd: "/tmp",
        ui: {
          input: async () => undefined,
          editor: async (_t: string, content: string) => content,
          select: async () => "Cancel",
          setStatus: () => {},
          setWidget: () => {},
          notify: () => {},
          custom: (async () => undefined as never) as never,
          theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
        },
        sessionManager: { getBranch: () => [] },
      },
    });
    const cancelled = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: false, skipReview: true, autonomous: false },
      },
      cancelPctx,
    );
    expect(cancelled.kind).toBe("cancelled");
    const cancelAgents = cancelAgent.mock.calls.map((c) => c[0]);
    expect(cancelAgents).not.toContain("implementor");
    expect(cancelAgents).not.toContain("refactorer");

    // --- Blocked path: implementor triggers blocked signal.
    const { signalExists, readSignal } = await import("@callumvass/forgeflow-shared/pipeline");
    vi.mocked(signalExists).mockReturnValueOnce(true);
    vi.mocked(readSignal).mockReturnValueOnce("cannot proceed");
    const blockAgent = sequencedRunAgent([{ output: "impl" }]);
    const blockPctx = mockPipelineContext({ cwd: "/tmp", runAgentFn: blockAgent, execFn: emptyDiffExec() });
    const blocked = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: true, skipReview: false, autonomous: false },
      },
      blockPctx,
    );
    expect(blocked.kind).toBe("blocked");
    if (blocked.kind !== "blocked") throw new Error("unreachable");
    expect(blocked.reason).toBe("cannot proceed");
    const blockedAgents = blockAgent.mock.calls.map((c) => c[0]);
    expect(blockedAgents).not.toContain("refactorer");
    expect(blockedAgents).not.toContain("code-reviewer");
  });

  it("returns failed when architecture-reviewer fails and does not start implementor", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Do stuff" },
      { output: "arch failed", status: "failed" },
    ]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: emptyDiffExec() });

    const outcome = await runImplementation(
      {
        issueContext: "Issue #42: Test issue\n\nIssue body",
        resolved,
        flags: { skipPlan: false, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.error).toContain("Architecture reviewer failed");
    const agents = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agents).toEqual(["planner", "architecture-reviewer"]);
  });

  it("returns failed when implementor fails and does not continue to refactorer", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "impl failed", status: "failed" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: emptyDiffExec() });

    const outcome = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.error).toContain("Implementor failed");
    const agents = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agents).toEqual(["implementor"]);
  });

  it("returns failed when refactorer fails", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "implemented" }, { output: "refactor failed", status: "failed" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: emptyDiffExec() });

    const outcome = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.error).toContain("Refactorer failed");
    const agents = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agents).toEqual(["implementor", "refactorer"]);
  });

  it("propagates flags.autonomous into the implementor prompt", async () => {
    // autonomous=true → clause present
    const autoAgent = mockRunAgent("done");
    const autoPctx = mockPipelineContext({ cwd: "/tmp", runAgentFn: autoAgent, execFn: emptyDiffExec() });
    await runImplementation(
      {
        issueContext: "Issue #42: Test\n\nBody",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: true },
      },
      autoPctx,
    );
    const autoImpl = autoAgent.mock.calls.find((c) => c[0] === "implementor");
    expect(autoImpl?.[1]).toContain("resolve them yourself using sensible defaults");

    // autonomous=false → clause absent
    const humanAgent = mockRunAgent("done");
    const humanPctx = mockPipelineContext({ cwd: "/tmp", runAgentFn: humanAgent, execFn: emptyDiffExec() });
    await runImplementation(
      {
        issueContext: "Issue #42: Test\n\nBody",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: false },
      },
      humanPctx,
    );
    const humanImpl = humanAgent.mock.calls.find((c) => c[0] === "implementor");
    expect(humanImpl?.[1]).not.toContain("resolve them yourself using sensible defaults");
  });
});
