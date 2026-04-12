import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mockPipelineContext, mockRunAgent, setupIsolatedHomeFixture } from "../../testing/index.js";
import { RUN_DIR_GITIGNORE_LINE, withRunLifecycle } from "./index.js";

const fixture = setupIsolatedHomeFixture("run-dir-lifecycle-persisted");

const PERSISTED_SESSIONS = { persist: true, archiveRuns: 20, archiveMaxAge: 30 };

describe("withRunLifecycle persisted runs", () => {
  it("wraps runAgentFn with persisted session allocation and archives clean runs as -success", async () => {
    const recorded: Array<{ agent: string; sessionPath: string | undefined; forkFrom: string | undefined }> = [];
    const baseRunAgent = mockRunAgent();
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: PERSISTED_SESSIONS,
      runAgentFn: vi.fn(async (agent, prompt, opts) => {
        recorded.push({ agent, sessionPath: opts.sessionPath, forkFrom: opts.forkFrom });
        return baseRunAgent(agent, prompt, opts);
      }),
    });

    const result = await withRunLifecycle(pctx, "implement-42", async (innerPctx) => {
      expect(innerPctx.runDir?.runId).toBe("implement-42");
      await innerPctx.runAgentFn("planner", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
      });
      await innerPctx.runAgentFn("implementor", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
      });
      return { isError: false };
    });

    expect(result).toEqual({ isError: false });
    expect(recorded).toHaveLength(2);
    expect(path.basename(recorded[0]?.sessionPath ?? "")).toBe("01-planner.jsonl");
    expect(path.basename(recorded[1]?.sessionPath ?? "")).toBe("02-implementor.jsonl");
    expect(recorded[0]?.forkFrom).toBeUndefined();

    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    expect(fs.existsSync(path.join(runRoot, "implement-42"))).toBe(false);
    expect(fs.readdirSync(path.join(runRoot, "archive"))[0]).toMatch(/-implement-42-success$/);
  });

  it("maps error results and thrown callbacks to failed runs that keep outcome.json in place", async () => {
    const failedResultPctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: PERSISTED_SESSIONS,
    });

    await withRunLifecycle(failedResultPctx, "implement-44", async () => ({ isError: true }));

    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    const failedResultMarker = JSON.parse(
      fs.readFileSync(path.join(runRoot, "implement-44", "outcome.json"), "utf-8"),
    ) as { outcome: string };
    expect(failedResultMarker.outcome).toBe("failed");

    const thrownPctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: PERSISTED_SESSIONS,
    });

    await expect(
      withRunLifecycle(thrownPctx, "implement-45", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    const thrownMarker = JSON.parse(fs.readFileSync(path.join(runRoot, "implement-45", "outcome.json"), "utf-8")) as {
      outcome: string;
    };
    expect(thrownMarker.outcome).toBe("failed");
  });

  it("passes explicit sessionPath and forkFrom through unchanged", async () => {
    const recorded: Array<{ sessionPath: string | undefined; forkFrom: string | undefined }> = [];
    const baseRunAgent = mockRunAgent();
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: PERSISTED_SESSIONS,
      runAgentFn: vi.fn(async (agent, prompt, opts) => {
        recorded.push({ sessionPath: opts.sessionPath, forkFrom: opts.forkFrom });
        return baseRunAgent(agent, prompt, opts);
      }),
    });

    await withRunLifecycle(pctx, "implement-43", async (innerPctx) => {
      const handle = innerPctx.runDir;
      if (!handle) throw new Error("expected runDir inside withRunLifecycle");

      const plannerPath = handle.allocSessionPath("planner");
      await innerPctx.runAgentFn("planner", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
        sessionPath: plannerPath,
      });

      const implementorPath = handle.allocSessionPath("implementor");
      await innerPctx.runAgentFn("implementor", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
        sessionPath: implementorPath,
        forkFrom: plannerPath,
      });

      return { isError: false };
    });

    expect(path.basename(recorded[0]?.sessionPath ?? "")).toBe("01-planner.jsonl");
    expect(path.basename(recorded[1]?.sessionPath ?? "")).toBe("02-implementor.jsonl");
    expect(recorded[1]?.forkFrom).toBe(recorded[0]?.sessionPath);
  });

  it("ensures the first persisted run writes the run-dir gitignore rule", async () => {
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: PERSISTED_SESSIONS,
    });

    await withRunLifecycle(pctx, "implement-47", async () => ({ isError: false }));

    expect(fs.readFileSync(path.join(fixture.cwdDir, ".gitignore"), "utf-8")).toContain(RUN_DIR_GITIGNORE_LINE);
  });
});
