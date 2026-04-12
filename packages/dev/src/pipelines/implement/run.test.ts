import { readUnifiedDiffAgainstMain } from "@callumvass/forgeflow-shared/repository";
import { mockExecFn, mockPipelineContext, mockRunAgent, sequencedRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { makeGitHubResolvedIssue } from "../../issues/tracker.fixtures.js";
import { runImplementation } from "./run.js";

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

vi.mock("@callumvass/forgeflow-shared/repository", () => ({
  readUnifiedDiffAgainstMain: vi.fn(async () => ""),
}));

const resolved = makeGitHubResolvedIssue();

function idleExec() {
  return mockExecFn();
}

describe("runImplementation", () => {
  it("fresh run returns completed with stages planner, architecture-reviewer, implementor, refactorer in order", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Do stuff" },
      { output: "No architectural recommendations" },
      { output: "implemented" },
      { output: "refactored" },
    ]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: idleExec() });

    const outcome = await runImplementation(
      {
        issueContext: "Issue #42: Test issue\n\nIssue body",
        resolved,
        flags: { skipPlan: false, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("completed");
    expect(outcome.stages.map((stage) => stage.name)).toEqual([
      "planner",
      "architecture-reviewer",
      "implementor",
      "refactorer",
    ]);
  });

  it("skipPlan/skipReview flags drop planner+architecture-reviewer and prevent review phase from running", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "implemented" }, { output: "refactored" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: idleExec() });

    const outcome = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("completed");
    const names = outcome.stages.map((stage) => stage.name);
    expect(names).not.toContain("planner");
    expect(names).not.toContain("architecture-reviewer");
    expect(names).not.toContain("code-reviewer");
    expect(names).not.toContain("fix-findings");
    expect(runAgentFn.mock.calls.map((call) => call[0])).toEqual(["implementor", "refactorer"]);
  });

  it("cancelled + blocked outcomes: cancelled returns early; blocked bubbles reason with no refactor/review", async () => {
    const cancelAgent = sequencedRunAgent([{ output: "## Plan" }, { output: "No notes" }]);
    const cancelPctx = mockPipelineContext({
      cwd: "/tmp",
      runAgentFn: cancelAgent,
      execFn: idleExec(),
      ctx: {
        hasUI: true,
        cwd: "/tmp",
        ui: {
          input: async () => undefined,
          editor: async (_task: string, content: string) => content,
          select: async () => "Cancel",
          setStatus: () => {},
          setWidget: () => {},
          notify: () => {},
          custom: (async () => undefined as never) as never,
          theme: { fg: (_category: string, text: string) => text, bold: (text: string) => text },
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
    expect(cancelAgent.mock.calls.map((call) => call[0])).not.toContain("implementor");
    expect(cancelAgent.mock.calls.map((call) => call[0])).not.toContain("refactorer");

    const { readSignal, signalExists } = await import("@callumvass/forgeflow-shared/pipeline");
    vi.mocked(signalExists).mockReturnValueOnce(true);
    vi.mocked(readSignal).mockReturnValueOnce("cannot proceed");
    const blockAgent = sequencedRunAgent([{ output: "impl" }]);
    const blockPctx = mockPipelineContext({ cwd: "/tmp", runAgentFn: blockAgent, execFn: idleExec() });
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
    const blockedAgents = blockAgent.mock.calls.map((call) => call[0]);
    expect(blockedAgents).not.toContain("refactorer");
    expect(blockedAgents).not.toContain("code-reviewer");
  });

  it("returns failed when architecture-reviewer fails and does not start implementor", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Do stuff" },
      { output: "arch failed", status: "failed" },
    ]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: idleExec() });

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
    expect(runAgentFn.mock.calls.map((call) => call[0])).toEqual(["planner", "architecture-reviewer"]);
  });

  it("returns failed when implementor fails and does not continue to refactorer", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "impl failed", status: "failed" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: idleExec() });

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
    expect(runAgentFn.mock.calls.map((call) => call[0])).toEqual(["implementor"]);
  });

  it("returns failed when refactorer fails", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "implemented" }, { output: "refactor failed", status: "failed" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: idleExec() });

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
    expect(runAgentFn.mock.calls.map((call) => call[0])).toEqual(["implementor", "refactorer"]);
  });

  it("short-circuits review work when the shared repository diff against main is empty", async () => {
    vi.mocked(readUnifiedDiffAgainstMain).mockResolvedValueOnce("");
    const runAgentFn = sequencedRunAgent([{ output: "implemented" }, { output: "refactored" }]);
    const pctx = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn: idleExec() });

    const outcome = await runImplementation(
      {
        issueContext: "ctx",
        resolved,
        flags: { skipPlan: true, skipReview: false, autonomous: false },
      },
      pctx,
    );

    expect(outcome.kind).toBe("completed");
    expect(readUnifiedDiffAgainstMain).toHaveBeenCalledWith({ cwd: "/tmp", execFn: pctx.execFn });
    expect(outcome.stages.map((stage) => stage.name)).toEqual(["implementor", "refactorer"]);
  });

  it("propagates flags.autonomous into the implementor prompt", async () => {
    const autoAgent = mockRunAgent("done");
    const autoPctx = mockPipelineContext({ cwd: "/tmp", runAgentFn: autoAgent, execFn: idleExec() });
    await runImplementation(
      {
        issueContext: "Issue #42: Test\n\nBody",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: true },
      },
      autoPctx,
    );
    const autoImplementorCall = autoAgent.mock.calls.find((call) => call[0] === "implementor");
    expect(autoImplementorCall?.[1]).toContain("resolve them yourself using sensible defaults");

    const humanAgent = mockRunAgent("done");
    const humanPctx = mockPipelineContext({ cwd: "/tmp", runAgentFn: humanAgent, execFn: idleExec() });
    await runImplementation(
      {
        issueContext: "Issue #42: Test\n\nBody",
        resolved,
        flags: { skipPlan: true, skipReview: true, autonomous: false },
      },
      humanPctx,
    );
    const humanImplementorCall = humanAgent.mock.calls.find((call) => call[0] === "implementor");
    expect(humanImplementorCall?.[1]).not.toContain("resolve them yourself using sensible defaults");
  });
});
