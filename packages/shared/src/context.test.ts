import { describe, expect, it, vi } from "vitest";
import type { PipelineContext } from "./context.js";
import { toAgentOpts, toPipelineContext } from "./context.js";
import { mockForgeflowContext } from "./test-utils.js";

describe("toPipelineContext", () => {
  it("bundles arguments into a PipelineContext", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();
    const pctx = toPipelineContext("/tmp/test", signal, onUpdate, ctx, "/my/agents");

    expect(pctx).toEqual({ cwd: "/tmp/test", signal, onUpdate, ctx, agentsDir: "/my/agents" });
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
