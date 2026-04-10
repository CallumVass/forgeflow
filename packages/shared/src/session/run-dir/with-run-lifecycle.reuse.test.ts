import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mockPipelineContext, mockRunAgent, setupIsolatedHomeFixture } from "../../test-utils.js";
import { withRunLifecycle } from "./index.js";

const fixture = setupIsolatedHomeFixture("run-dir-lifecycle-reuse");

const PERSISTED_SESSIONS = { persist: true, archiveRuns: 20, archiveMaxAge: 30 };

describe("withRunLifecycle reuse and opt-out", () => {
  it("reuses the outer run lifecycle for nested calls", async () => {
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: PERSISTED_SESSIONS,
    });

    const seenRunIds: string[] = [];

    await withRunLifecycle(pctx, "outer", async (outerPctx) => {
      if (outerPctx.runDir) seenRunIds.push(outerPctx.runDir.runId);
      await withRunLifecycle(outerPctx, "ignored-inner", async (innerPctx) => {
        if (innerPctx.runDir) seenRunIds.push(innerPctx.runDir.runId);
        return { isError: false };
      });
      return { isError: false };
    });

    expect(seenRunIds).toEqual(["outer", "outer"]);
    const archiveEntries = fs.readdirSync(path.join(fixture.cwdDir, ".forgeflow", "run", "archive"));
    expect(archiveEntries.filter((entry) => entry.endsWith("-success"))).toHaveLength(1);
  });

  it("is a no-op when persistence is disabled", async () => {
    const fallbackRunAgent = mockRunAgent();
    const baseRunAgent = vi.fn(async (agent: string, prompt: string, opts: { sessionPath?: string }) => {
      expect(opts.sessionPath).toBeUndefined();
      return fallbackRunAgent(agent, prompt, {
        agentsDir: "",
        cwd: fixture.cwdDir,
        stages: [],
        pipeline: "implement",
      });
    });
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: false, archiveRuns: 20, archiveMaxAge: 30 },
      runAgentFn: baseRunAgent,
    });

    await withRunLifecycle(pctx, "implement-46", async (innerPctx) => {
      expect(innerPctx.runDir).toBeUndefined();
      expect(innerPctx.runAgentFn).toBe(baseRunAgent);
      await innerPctx.runAgentFn("planner", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
      });
      return { isError: false };
    });

    expect(fs.existsSync(path.join(fixture.cwdDir, ".forgeflow", "run"))).toBe(false);
  });
});
