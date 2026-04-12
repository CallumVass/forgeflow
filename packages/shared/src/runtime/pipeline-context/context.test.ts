import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exec, execSafe } from "../../io/index.js";
import { mockForgeflowContext, setupIsolatedHomeFixture } from "../../testing/index.js";
import { runAgent } from "../run-agent.js";
import { toPipelineContext } from "./context.js";

describe("pipeline-context/toPipelineContext", () => {
  const fixture = setupIsolatedHomeFixture("pipeline-context");

  it("builds a compatible PipelineContext with default seam fields", () => {
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
      skillsConfig: { enabled: true, extraPaths: [], maxSelected: 4 },
      selectedSkills: [],
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
    });
  });

  it("loads forgeflow.json once and routes warnings through ctx.ui.notify", () => {
    const globalDir = path.join(fixture.homeDir, ".pi", "agent");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "forgeflow.json"),
      JSON.stringify({ agents: { implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" } } }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(fixture.cwdDir, ".forgeflow.json"),
      JSON.stringify({
        agents: { planner: { model: "claude-opus-4-5", thinkingLevel: "turbo" } },
        skills: { extraPaths: ["./skills"], maxSelected: 2 },
      }),
      "utf-8",
    );

    const notify = vi.fn();
    const ctx = mockForgeflowContext({ ui: { notify } });

    const pctx = toPipelineContext(fixture.cwdDir, AbortSignal.timeout(5000), vi.fn(), ctx, "/my/agents");

    expect(pctx.agentOverrides).toEqual({
      implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" },
      planner: { model: "claude-opus-4-5" },
    });
    expect(pctx.skillsConfig).toEqual({
      enabled: true,
      extraPaths: [path.join(fixture.cwdDir, "skills")],
      maxSelected: 2,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toBe("warning");
  });
});
