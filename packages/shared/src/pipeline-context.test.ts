import { describe, expect, it, vi } from "vitest";
import { type PipelineContext, toAgentOpts, toPipelineContext } from "./context.js";
import { mockForgeflowContext, mockPipelineContext } from "./test-utils.js";

describe("toPipelineContext", () => {
  it("includes agentsDir in the returned object", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();

    const pctx = toPipelineContext("/tmp/test", signal, onUpdate, ctx, "/my/agents");

    expect(pctx.agentsDir).toBe("/my/agents");
    expect(pctx.cwd).toBe("/tmp/test");
    expect(pctx.signal).toBe(signal);
    expect(pctx.onUpdate).toBe(onUpdate);
    expect(pctx.ctx).toBe(ctx);
  });
});

describe("toAgentOpts", () => {
  it("reads agentsDir from the context instead of the extra parameter", () => {
    const pctx: PipelineContext = {
      cwd: "/tmp/test",
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx: mockForgeflowContext(),
      agentsDir: "/agents",
    };

    const result = toAgentOpts(pctx, {
      stages: [],
      pipeline: "implement",
    });

    expect(result).toEqual({
      cwd: "/tmp/test",
      signal: pctx.signal,
      onUpdate: undefined,
      agentsDir: "/agents",
      stages: [],
      pipeline: "implement",
    });
  });

  it("passes through onUpdate when provided", () => {
    const onUpdate = vi.fn();
    const pctx: PipelineContext = {
      cwd: "/project",
      signal: AbortSignal.timeout(1000),
      onUpdate,
      ctx: mockForgeflowContext(),
      agentsDir: "/a",
    };

    const result = toAgentOpts(pctx, {
      stages: [],
      pipeline: "review",
    });

    expect(result.onUpdate).toBe(onUpdate);
  });
});

describe("mockPipelineContext", () => {
  it("returns valid defaults including agentsDir", () => {
    const pctx = mockPipelineContext();

    expect(pctx.cwd).toBe("/tmp/test");
    expect(pctx.signal).toBeInstanceOf(AbortSignal);
    expect(pctx.onUpdate).toBeUndefined();
    expect(pctx.ctx).toBeDefined();
    expect(pctx.ctx.hasUI).toBe(false);
    expect(pctx.agentsDir).toBe("/tmp/agents");
  });

  it("accepts agentsDir overrides", () => {
    const pctx = mockPipelineContext({ agentsDir: "/custom/agents" });

    expect(pctx.agentsDir).toBe("/custom/agents");
  });

  it("merges overrides including nested ctx", () => {
    const pctx = mockPipelineContext({
      cwd: "/custom",
      ctx: { hasUI: true, cwd: "/custom", ui: expect.anything() },
    });

    expect(pctx.cwd).toBe("/custom");
    expect(pctx.ctx.hasUI).toBe(true);
  });
});
