import { emptyStage, type RunAgentFn, type StageResult } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { type Phase, runChain } from "./chain.js";

/**
 * Recorded fields from a single `runAgentFn` invocation that the tests
 * below assert against. Keeping this tuple small keeps the expectations
 * readable without coupling them to every field on `RunAgentOpts`.
 */
interface Recorded {
  agent: string;
  stageName: string | undefined;
  sessionPath: string | undefined;
  forkFrom: string | undefined;
  task: string;
}

function makeRecordingRunAgent(): { runAgentFn: RunAgentFn; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const runAgentFn = vi.fn(async (agent, task, opts) => {
    calls.push({
      agent,
      stageName: opts.stageName,
      sessionPath: opts.sessionPath,
      forkFrom: opts.forkFrom,
      task,
    });
    return {
      ...emptyStage(opts.stageName ?? agent),
      status: "done" as const,
      output: `${agent}-output`,
    };
  });
  return { runAgentFn, calls };
}

/**
 * Fake runDir whose `allocSessionPath` returns a predictable sequence
 * of paths per stage name — lets the tests assert on fork threading
 * without touching disk.
 */
function fakeRunDir(): { runId: string; dir: string; allocSessionPath: (name: string) => string } {
  let counter = 0;
  return {
    runId: "test-run",
    dir: "/tmp/test-run",
    allocSessionPath: (name: string) => {
      counter += 1;
      return `/tmp/test-run/${String(counter).padStart(2, "0")}-${name}.jsonl`;
    },
  };
}

function phase(agent: string, extras: Partial<Phase> = {}): Phase {
  return {
    agent,
    buildTask: (ctx) =>
      `${agent}-task isFirst=${ctx.isFirstInChain} custom=${ctx.customPrompt ?? "-"} plan=${ctx.plan ?? "-"}`,
    ...extras,
  };
}

describe("runChain", () => {
  it("threads sessionPath through as the next phase's forkFrom so forks form a linear lineage", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });
    const stages: StageResult[] = [];

    const result = await runChain([phase("planner"), phase("implementor"), phase("refactorer")], pctx, {
      pipeline: "implement",
      stages,
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.forkFrom).toBeUndefined();
    expect(calls[0]?.sessionPath).toContain("01-planner.jsonl");
    expect(calls[1]?.forkFrom).toBe(calls[0]?.sessionPath);
    expect(calls[1]?.sessionPath).toContain("02-implementor.jsonl");
    expect(calls[2]?.forkFrom).toBe(calls[1]?.sessionPath);
    expect(calls[2]?.sessionPath).toContain("03-refactorer.jsonl");
    expect(result.lastSessionPath).toBe(calls[2]?.sessionPath);
  });

  it("injects customPrompt only into the first phase of the chain", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });

    await runChain([phase("planner"), phase("implementor")], pctx, {
      pipeline: "implement",
      stages: [],
      customPrompt: "use async iterators",
    });

    expect(calls[0]?.task).toContain("custom=use async iterators");
    expect(calls[1]?.task).toContain("custom=-");
  });

  it("resets forkFrom and re-injects customPrompt across a resetFork boundary", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });

    await runChain(
      [phase("planner"), phase("implementor"), phase("code-reviewer", { resetFork: true }), phase("review-judge")],
      pctx,
      { pipeline: "implement", stages: [], customPrompt: "be careful" },
    );

    // Build chain: planner and implementor share lineage, customPrompt on planner only.
    expect(calls[0]?.task).toContain("custom=be careful");
    expect(calls[1]?.task).toContain("custom=-");
    expect(calls[1]?.forkFrom).toBe(calls[0]?.sessionPath);

    // Review chain: reviewer starts cold (no forkFrom) AND sees customPrompt again.
    expect(calls[2]?.forkFrom).toBeUndefined();
    expect(calls[2]?.task).toContain("custom=be careful");

    // Judge forks from reviewer and does NOT see customPrompt (downstream in same chain).
    expect(calls[3]?.forkFrom).toBe(calls[2]?.sessionPath);
    expect(calls[3]?.task).toContain("custom=-");
  });

  it("passes initialForkFrom to the first phase so planning can be threaded in from outside", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });

    await runChain([phase("implementor")], pctx, {
      pipeline: "implement",
      stages: [],
      initialForkFrom: "/tmp/plan-session.jsonl",
    });

    expect(calls[0]?.forkFrom).toBe("/tmp/plan-session.jsonl");
  });

  it("threads the captured plan into every phase's buildTask", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });

    await runChain([phase("implementor"), phase("refactorer")], pctx, {
      pipeline: "implement",
      stages: [],
      plan: "TDD-THE-THING",
    });

    expect(calls[0]?.task).toContain("plan=TDD-THE-THING");
    expect(calls[1]?.task).toContain("plan=TDD-THE-THING");
  });

  it("uses stageName over agent name for both StageResult identity and session-path naming", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });
    const stages: StageResult[] = [];

    await runChain([phase("implementor", { stageName: "fix-findings" })], pctx, { pipeline: "implement", stages });

    expect(calls[0]?.agent).toBe("implementor");
    expect(calls[0]?.stageName).toBe("fix-findings");
    expect(calls[0]?.sessionPath).toContain("fix-findings.jsonl");
    expect(stages.some((s) => s.name === "fix-findings")).toBe(true);
  });

  it("reuses an existing StageResult when one with the same name is already in stages", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    const pctx = mockPipelineContext({ runAgentFn, runDir: fakeRunDir() });
    const stages: StageResult[] = [emptyStage("planner")];

    await runChain([phase("planner")], pctx, { pipeline: "implement", stages });

    // Did not append a second planner stage.
    expect(stages.filter((s) => s.name === "planner")).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("leaves sessionPath / forkFrom undefined when runDir is not set (persistence off)", async () => {
    const { runAgentFn, calls } = makeRecordingRunAgent();
    // mockPipelineContext defaults to runDir: undefined + sessionsConfig.persist: false.
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runChain([phase("planner"), phase("implementor")], pctx, {
      pipeline: "implement",
      stages: [],
    });

    expect(calls[0]?.sessionPath).toBeUndefined();
    expect(calls[0]?.forkFrom).toBeUndefined();
    expect(calls[1]?.sessionPath).toBeUndefined();
    expect(calls[1]?.forkFrom).toBeUndefined();
    expect(result.lastSessionPath).toBeUndefined();
  });
});
