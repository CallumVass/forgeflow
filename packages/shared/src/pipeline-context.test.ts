import { describe, expect, it, vi } from "vitest";
import { mockForgeflowContext, mockPipelineContext } from "./test-utils.js";
import type { PipelineContext } from "./types.js";
import { toAgentOpts } from "./types.js";

describe("toAgentOpts", () => {
  it("converts PipelineContext + extras into a complete RunAgentOpts", () => {
    const pctx: PipelineContext = {
      cwd: "/tmp/test",
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx: mockForgeflowContext(),
    };

    const result = toAgentOpts(pctx, {
      agentsDir: "/agents",
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
    };

    const result = toAgentOpts(pctx, {
      agentsDir: "/a",
      stages: [],
      pipeline: "review",
    });

    expect(result.onUpdate).toBe(onUpdate);
  });
});

describe("mockPipelineContext", () => {
  it("returns valid defaults", () => {
    const pctx = mockPipelineContext();

    expect(pctx.cwd).toBe("/tmp/test");
    expect(pctx.signal).toBeInstanceOf(AbortSignal);
    expect(pctx.onUpdate).toBeUndefined();
    expect(pctx.ctx).toBeDefined();
    expect(pctx.ctx.hasUI).toBe(false);
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
