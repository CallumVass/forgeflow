import { describe, expect, it, vi } from "vitest";
import type { RunAgentOpts } from "./pipeline.js";
import { mockExecFn, mockPipelineContext, mockRunAgent } from "./test-utils.js";

const stubOpts: RunAgentOpts = {
  agentsDir: "/agents",
  cwd: "/tmp",
  stages: [],
  pipeline: "test",
};

describe("mockPipelineContext", () => {
  it("defaults runAgentFn / execFn / execSafeFn to spy functions", () => {
    const pctx = mockPipelineContext();

    expect(vi.isMockFunction(pctx.runAgentFn)).toBe(true);
    expect(vi.isMockFunction(pctx.execFn)).toBe(true);
    expect(vi.isMockFunction(pctx.execSafeFn)).toBe(true);
  });

  it("uses each injected override individually", () => {
    const runAgentFn = mockRunAgent("hello");
    const execFn = vi.fn(async () => "exec-output");
    const execSafeFn = vi.fn(async () => "safe-output");

    const pctx = mockPipelineContext({ runAgentFn, execFn, execSafeFn });

    expect(pctx.runAgentFn).toBe(runAgentFn);
    expect(pctx.execFn).toBe(execFn);
    expect(pctx.execSafeFn).toBe(execSafeFn);
  });

  it("preserves cwd, agentsDir and onUpdate overrides while keeping default seam spies", () => {
    const onUpdate = vi.fn();
    const pctx = mockPipelineContext({ cwd: "/proj", agentsDir: "/proj/agents", onUpdate });

    expect(pctx.cwd).toBe("/proj");
    expect(pctx.agentsDir).toBe("/proj/agents");
    expect(pctx.onUpdate).toBe(onUpdate);
    expect(vi.isMockFunction(pctx.runAgentFn)).toBe(true);
    expect(vi.isMockFunction(pctx.execFn)).toBe(true);
  });
});

describe("mockRunAgent", () => {
  it("returns a StageResult-shaped object with configurable output and status", async () => {
    const mock = mockRunAgent("test output", "failed");
    const result = await mock("agent", "prompt", stubOpts);

    expect(result).toMatchObject({
      name: "agent",
      output: "test output",
      status: "failed",
      stderr: "",
      exitCode: -1,
      messages: [],
    });
    expect(result.usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 0,
    });
  });

  it("defaults to empty output and done status", async () => {
    const mock = mockRunAgent();
    const result = await mock("agent", "prompt", stubOpts);

    expect(result.output).toBe("");
    expect(result.status).toBe("done");
  });
});

describe("mockExecFn", () => {
  it("returns scripted responses for matching command substrings", async () => {
    const exec = mockExecFn({ "git diff": "diff-output", "gh pr view": "42" });

    expect(await exec("git diff main...HEAD", "/tmp")).toBe("diff-output");
    expect(await exec("gh pr view --json number", "/tmp")).toBe("42");
  });

  it("falls through to an empty string when no pattern matches", async () => {
    const exec = mockExecFn({ "git diff": "diff" });

    expect(await exec("echo hi", "/tmp")).toBe("");
  });

  it("captures every call so tests can assert on argument lists", async () => {
    const exec = mockExecFn();
    await exec("first", "/cwd");
    await exec("second", "/cwd");

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(1, "first", "/cwd");
    expect(exec).toHaveBeenNthCalledWith(2, "second", "/cwd");
  });
});
