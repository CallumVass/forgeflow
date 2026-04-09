import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exec, execSafe } from "../exec.js";
import { mockForgeflowContext, setupIsolatedHomeFixture } from "../test-utils.js";
import type { PipelineContext } from "./context.js";
import { toAgentOpts, toPipelineContext } from "./context.js";
import { runAgent } from "./run-agent.js";

describe("toPipelineContext", () => {
  // Isolate the on-disk forgeflow.json loader so the user's real
  // ~/.pi/agent/forgeflow.json can't contaminate these tests.
  const fixture = setupIsolatedHomeFixture("ctx");

  it("bundles arguments into a PipelineContext with default seam fields", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();
    const pctx = toPipelineContext(fixture.cwdDir, signal, onUpdate, ctx, "/my/agents");

    expect(pctx).toEqual({
      cwd: fixture.cwdDir,
      signal,
      onUpdate,
      ctx,
      agentsDir: "/my/agents",
      runAgentFn: runAgent,
      execFn: exec,
      execSafeFn: execSafe,
      agentOverrides: {},
      // Back-filled with DEFAULT_SESSIONS when no forgeflow.json is present.
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
    });
  });

  it("applies overrides for runAgentFn / execFn / execSafeFn / agentOverrides when supplied", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();
    const runAgentFn = vi.fn();
    const execFn = vi.fn();
    const execSafeFn = vi.fn();
    const agentOverrides = { planner: { model: "claude-opus-4-5" } };

    const pctx = toPipelineContext(fixture.cwdDir, signal, onUpdate, ctx, "/my/agents", {
      runAgentFn,
      execFn,
      execSafeFn,
      agentOverrides,
    });

    expect(pctx.runAgentFn).toBe(runAgentFn);
    expect(pctx.execFn).toBe(execFn);
    expect(pctx.execSafeFn).toBe(execSafeFn);
    expect(pctx.agentOverrides).toBe(agentOverrides);
  });

  it("loads forgeflow.json from disk and routes loader warnings through ctx.ui.notify", () => {
    // Global config: provides an implementor override.
    const globalDir = path.join(fixture.homeDir, ".pi", "agent");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "forgeflow.json"),
      JSON.stringify({
        agents: { implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" } },
      }),
      "utf-8",
    );
    // Project config: overrides planner + carries an invalid thinkingLevel
    // so we can assert the loader warning is routed to ctx.ui.notify.
    fs.writeFileSync(
      path.join(fixture.cwdDir, ".forgeflow.json"),
      JSON.stringify({
        agents: {
          planner: { model: "claude-opus-4-5", thinkingLevel: "turbo" },
        },
      }),
      "utf-8",
    );

    const notify = vi.fn();
    const ctx = mockForgeflowContext({ ui: { notify } });

    const pctx = toPipelineContext(fixture.cwdDir, AbortSignal.timeout(5000), vi.fn(), ctx, "/my/agents");

    expect(pctx.agentOverrides).toEqual({
      implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" },
      planner: { model: "claude-opus-4-5" }, // invalid thinkingLevel dropped
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toBe("warning");
  });
});

describe("toAgentOpts", () => {
  it("converts PipelineContext + extras into RunAgentOpts and forwards agentOverrides", () => {
    const onUpdate = vi.fn();
    const agentOverrides = { planner: { model: "claude-opus-4-5" } };
    const pctx: PipelineContext = {
      cwd: "/project",
      signal: AbortSignal.timeout(1000),
      onUpdate,
      ctx: mockForgeflowContext(),
      agentsDir: "/a",
      runAgentFn: vi.fn(),
      execFn: vi.fn(),
      execSafeFn: vi.fn(),
      agentOverrides,
    };
    const result = toAgentOpts(pctx, { stages: [], pipeline: "review" });

    expect(result).toEqual({
      cwd: "/project",
      signal: pctx.signal,
      onUpdate,
      agentsDir: "/a",
      agentOverrides,
      stages: [],
      pipeline: "review",
    });
  });
});
