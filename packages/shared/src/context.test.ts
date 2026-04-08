import { describe, expect, it, vi } from "vitest";
import type { PipelineContext } from "./context.js";
import { toAgentOpts, toPipelineContext } from "./context.js";
import { exec, execSafe } from "./exec.js";
import { runAgent } from "./run-agent.js";
import { mockForgeflowContext } from "./test-utils.js";

describe("toPipelineContext", () => {
  it("bundles arguments into a PipelineContext with default seam fields", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();
    const pctx = toPipelineContext("/tmp/test", signal, onUpdate, ctx, "/my/agents");

    expect(pctx).toEqual({
      cwd: "/tmp/test",
      signal,
      onUpdate,
      ctx,
      agentsDir: "/my/agents",
      runAgentFn: runAgent,
      execFn: exec,
      execSafeFn: execSafe,
    });
  });

  it("applies overrides for runAgentFn / execFn / execSafeFn when supplied", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();
    const runAgentFn = vi.fn();
    const execFn = vi.fn();
    const execSafeFn = vi.fn();

    const pctx = toPipelineContext("/tmp/test", signal, onUpdate, ctx, "/my/agents", {
      runAgentFn,
      execFn,
      execSafeFn,
    });

    expect(pctx.runAgentFn).toBe(runAgentFn);
    expect(pctx.execFn).toBe(execFn);
    expect(pctx.execSafeFn).toBe(execSafeFn);
  });
});

describe("toAgentOpts", () => {
  it("converts PipelineContext + extras into RunAgentOpts", () => {
    const onUpdate = vi.fn();
    const pctx: PipelineContext = {
      cwd: "/project",
      signal: AbortSignal.timeout(1000),
      onUpdate,
      ctx: mockForgeflowContext(),
      agentsDir: "/a",
      runAgentFn: vi.fn(),
      execFn: vi.fn(),
      execSafeFn: vi.fn(),
    };
    const result = toAgentOpts(pctx, { stages: [], pipeline: "review" });

    expect(result).toEqual({
      cwd: "/project",
      signal: pctx.signal,
      onUpdate,
      agentsDir: "/a",
      stages: [],
      pipeline: "review",
    });
  });
});
