import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSIONS } from "../config/forgeflow-config.js";
import { mockPipelineContext, setupIsolatedHomeFixture } from "../test-utils.js";
import {
  archiveRunDir,
  createRunDir,
  ensureGitignore,
  gcArchive,
  RUN_DIR_GITIGNORE_LINE,
  withRunLifecycle,
} from "./run-dir.js";

const fixture = setupIsolatedHomeFixture("run-dir");

function readMode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

describe("createRunDir", () => {
  it("creates .forgeflow/run/<runId>/ at 0700 and allocSessionPath returns numbered 0600 files", () => {
    const handle = createRunDir(fixture.cwdDir, "implement-42", DEFAULT_SESSIONS);

    expect(handle.runId).toBe("implement-42");
    expect(handle.dir).toBe(path.join(fixture.cwdDir, ".forgeflow", "run", "implement-42"));
    expect(readMode(handle.dir)).toBe(0o700);

    const first = handle.allocSessionPath("planner");
    const second = handle.allocSessionPath("architecture-reviewer");
    const third = handle.allocSessionPath("implementor");

    expect(path.basename(first)).toBe("01-planner.jsonl");
    expect(path.basename(second)).toBe("02-architecture-reviewer.jsonl");
    expect(path.basename(third)).toBe("03-implementor.jsonl");
    expect(path.dirname(first)).toBe(handle.dir);
    // Every session file must be pre-created at 0600 so pi doesn't write to
    // a world-readable file later.
    expect(fs.existsSync(first)).toBe(true);
    expect(readMode(first)).toBe(0o600);
    expect(readMode(second)).toBe(0o600);
    expect(readMode(third)).toBe(0o600);
  });

  it("archives a stale dir with marker as -failed and a marker-less stale dir as -interrupted before creating fresh", () => {
    // First stale dir with a 'failed' marker (simulates prior failed run).
    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    const staleFailed = path.join(runRoot, "implement-7");
    fs.mkdirSync(staleFailed, { recursive: true });
    fs.writeFileSync(path.join(staleFailed, "outcome.json"), JSON.stringify({ outcome: "failed" }));
    fs.writeFileSync(path.join(staleFailed, "01-planner.jsonl"), "prior-run-data");

    const handle = createRunDir(fixture.cwdDir, "implement-7", DEFAULT_SESSIONS);

    const archiveDir = path.join(runRoot, "archive");
    const archivedEntries = fs.readdirSync(archiveDir);
    expect(archivedEntries.length).toBe(1);
    expect(archivedEntries[0]).toMatch(/-implement-7-failed$/);
    // Fresh directory exists and is empty.
    expect(fs.existsSync(handle.dir)).toBe(true);
    expect(fs.readdirSync(handle.dir)).toEqual([]);

    // Now simulate a crash: leave a stale dir with NO marker file.
    const staleCrash = path.join(runRoot, "implement-8");
    fs.mkdirSync(staleCrash, { recursive: true });
    fs.writeFileSync(path.join(staleCrash, "01-planner.jsonl"), "crashed-run");

    createRunDir(fixture.cwdDir, "implement-8", DEFAULT_SESSIONS);

    const afterCrash = fs.readdirSync(archiveDir);
    expect(afterCrash.length).toBe(2);
    expect(afterCrash.some((e) => e.endsWith("-implement-8-interrupted"))).toBe(true);
  });
});

describe("archiveRunDir", () => {
  it("renames the run dir under archive/ with the outcome suffix on success/cancelled, and writes a marker without moving on failed", () => {
    // --- success ---
    const successHandle = createRunDir(fixture.cwdDir, "run-a", DEFAULT_SESSIONS);
    const sessionA = successHandle.allocSessionPath("planner");
    fs.writeFileSync(sessionA, "success-session");
    archiveRunDir(fixture.cwdDir, successHandle, "success");
    expect(fs.existsSync(successHandle.dir)).toBe(false);
    const archiveDir = path.join(fixture.cwdDir, ".forgeflow", "run", "archive");
    const afterSuccess = fs.readdirSync(archiveDir);
    expect(afterSuccess.length).toBe(1);
    expect(afterSuccess[0]).toMatch(/-run-a-success$/);

    // --- cancelled ---
    const cancelHandle = createRunDir(fixture.cwdDir, "run-b", DEFAULT_SESSIONS);
    cancelHandle.allocSessionPath("planner");
    archiveRunDir(fixture.cwdDir, cancelHandle, "cancelled");
    expect(fs.existsSync(cancelHandle.dir)).toBe(false);
    expect(fs.readdirSync(archiveDir).some((e) => e.endsWith("-run-b-cancelled"))).toBe(true);

    // --- failed: leave in place but write a marker ---
    const failHandle = createRunDir(fixture.cwdDir, "run-c", DEFAULT_SESSIONS);
    failHandle.allocSessionPath("planner");
    archiveRunDir(fixture.cwdDir, failHandle, "failed");
    expect(fs.existsSync(failHandle.dir)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(path.join(failHandle.dir, "outcome.json"), "utf-8"));
    expect(marker.outcome).toBe("failed");
    // Make sure it wasn't also archived.
    expect(fs.readdirSync(archiveDir).some((e) => e.endsWith("-run-c-failed"))).toBe(false);
  });
});

describe("ensureGitignore", () => {
  it("appends the run-dir line to a missing/uncovered .gitignore and logs once; is a no-op when already covered", () => {
    const log = vi.fn();
    const gitignorePath = path.join(fixture.cwdDir, ".gitignore");

    // Case A: no .gitignore at all → create + log.
    ensureGitignore(fixture.cwdDir, log);
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const contents = fs.readFileSync(gitignorePath, "utf-8");
    expect(contents).toContain(RUN_DIR_GITIGNORE_LINE);
    expect(log).toHaveBeenCalledTimes(1);

    // Case B: already covered → no-op, no extra log, no duplication.
    log.mockClear();
    ensureGitignore(fixture.cwdDir, log);
    const afterSecond = fs.readFileSync(gitignorePath, "utf-8");
    expect(afterSecond).toBe(contents);
    expect(log).not.toHaveBeenCalled();

    // Case C: existing .gitignore without coverage → appends + log.
    fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n");
    log.mockClear();
    ensureGitignore(fixture.cwdDir, log);
    const afterAppend = fs.readFileSync(gitignorePath, "utf-8");
    expect(afterAppend).toContain("node_modules/");
    expect(afterAppend).toContain(RUN_DIR_GITIGNORE_LINE);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("gcArchive", () => {
  it("prunes archive entries beyond archiveRuns count and beyond archiveMaxAge days, keeping the most recent entries", () => {
    const archiveDir = path.join(fixture.cwdDir, ".forgeflow", "run", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });

    // Six entries total; we keep at most 3 by count AND prune anything older
    // than 5 days by age. Two of the entries are backdated 30 days.
    const names = [
      "20240101-000000-run-1-success",
      "20240101-000001-run-2-success",
      "20240101-000002-run-3-success",
      "20240101-000003-run-4-success",
      "20240101-000004-run-5-success",
      "20240101-000005-run-6-success",
    ];
    for (const name of names) fs.mkdirSync(path.join(archiveDir, name));

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Backdate entries 1 and 2 to 30 days ago so the age limit prunes them;
    // stamp entries 3..6 with deterministic, monotonically increasing mtimes
    // 4 days back so we can predict which 3 survive the count-based prune.
    // Iterating via `.entries()` keeps `name` strictly typed as `string`
    // (no `noUncheckedIndexedAccess` null assertions needed).
    const recentBase = now - 4 * day;
    for (const [i, name] of names.entries()) {
      const target = path.join(archiveDir, name);
      if (i < 2) {
        const stale = new Date(now - 30 * day);
        fs.utimesSync(target, stale, stale);
      } else {
        const t = new Date(recentBase + i * 60_000);
        fs.utimesSync(target, t, t);
      }
    }

    gcArchive(fixture.cwdDir, { persist: true, archiveRuns: 3, archiveMaxAge: 5 });

    const survivors = fs.readdirSync(archiveDir).sort();
    // Entries 1 & 2 pruned by age, then 3 pruned by count → only 4, 5, 6 left.
    expect(survivors).toEqual([
      "20240101-000003-run-4-success",
      "20240101-000004-run-5-success",
      "20240101-000005-run-6-success",
    ]);
  });
});

describe("withRunLifecycle", () => {
  it("creates a run dir, auto-allocates session paths on runAgentFn, and archives as -success on clean return", async () => {
    const recorded: Array<{ agent: string; sessionPath: string | undefined; forkFrom: string | undefined }> = [];
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
      runAgentFn: vi.fn(async (agent, _prompt, opts) => {
        recorded.push({ agent, sessionPath: opts.sessionPath, forkFrom: opts.forkFrom });
        return {
          name: agent,
          status: "done",
          messages: [],
          exitCode: 0,
          stderr: "",
          output: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
        };
      }),
    });

    const result = await withRunLifecycle(pctx, "implement-42", async (innerPctx) => {
      // Inner context must carry runDir and a patched runAgentFn.
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

    // Each call got its own auto-allocated session file under the run dir.
    expect(recorded).toHaveLength(2);
    const [plannerCall, implCall] = recorded;
    expect(path.basename(plannerCall?.sessionPath ?? "")).toBe("01-planner.jsonl");
    expect(path.basename(implCall?.sessionPath ?? "")).toBe("02-implementor.jsonl");
    expect(plannerCall?.forkFrom).toBeUndefined();

    // On clean return, the directory moves under archive/ with -success.
    expect(result).toEqual({ isError: false });
    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    expect(fs.existsSync(path.join(runRoot, "implement-42"))).toBe(false);
    const archive = fs.readdirSync(path.join(runRoot, "archive"));
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatch(/-implement-42-success$/);
  });

  it("passes explicit sessionPath and forkFrom through to runAgentFn without auto-allocation", async () => {
    const recorded: Array<{ sessionPath: string | undefined; forkFrom: string | undefined }> = [];
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
      runAgentFn: vi.fn(async (_agent, _prompt, opts) => {
        recorded.push({ sessionPath: opts.sessionPath, forkFrom: opts.forkFrom });
        return {
          name: "mock",
          status: "done",
          messages: [],
          exitCode: 0,
          stderr: "",
          output: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
        };
      }),
    });

    await withRunLifecycle(pctx, "implement-43", async (innerPctx) => {
      const handle = innerPctx.runDir;
      if (!handle) throw new Error("expected runDir to be set inside withRunLifecycle");
      // Chain-builder-style explicit allocation + fork threading.
      const p1 = handle.allocSessionPath("planner");
      await innerPctx.runAgentFn("planner", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
        sessionPath: p1,
      });
      const p2 = handle.allocSessionPath("implementor");
      await innerPctx.runAgentFn("implementor", "task", {
        agentsDir: "",
        cwd: innerPctx.cwd,
        stages: [],
        pipeline: "implement",
        sessionPath: p2,
        forkFrom: p1,
      });
      return { isError: false };
    });

    const [firstCall, secondCall] = recorded;
    expect(firstCall?.forkFrom).toBeUndefined();
    expect(path.basename(firstCall?.sessionPath ?? "")).toBe("01-planner.jsonl");
    expect(path.basename(secondCall?.sessionPath ?? "")).toBe("02-implementor.jsonl");
    expect(secondCall?.forkFrom).toBe(firstCall?.sessionPath);
  });

  it("archives the run dir as -failed when the pipeline result is an error", async () => {
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
    });

    await withRunLifecycle(pctx, "implement-44", async () => ({ isError: true }));

    // Failed runs stay in place until the next run archives them.
    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    expect(fs.existsSync(path.join(runRoot, "implement-44"))).toBe(true);
    const marker = JSON.parse(fs.readFileSync(path.join(runRoot, "implement-44", "outcome.json"), "utf-8"));
    expect(marker.outcome).toBe("failed");
  });

  it("leaves the dir in place and archives as -failed when the pipeline throws", async () => {
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
    });

    await expect(
      withRunLifecycle(pctx, "implement-45", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    expect(fs.existsSync(path.join(runRoot, "implement-45"))).toBe(true);
    const marker = JSON.parse(fs.readFileSync(path.join(runRoot, "implement-45", "outcome.json"), "utf-8"));
    expect(marker.outcome).toBe("failed");
  });

  it("is a no-op when sessionsConfig.persist is false — no dir created, runAgentFn unpatched", async () => {
    const baseRunAgent = vi.fn(async (_agent: string, _prompt: string, opts: { sessionPath?: string }) => {
      // Sees the caller's sessionPath untouched (undefined in this test).
      expect(opts.sessionPath).toBeUndefined();
      return {
        name: "mock",
        status: "done" as const,
        messages: [],
        exitCode: 0,
        stderr: "",
        output: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
      };
    });
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: false, archiveRuns: 20, archiveMaxAge: 30 },
      runAgentFn: baseRunAgent,
    });

    await withRunLifecycle(pctx, "implement-46", async (innerPctx) => {
      // No run dir attached, runAgentFn is the unpatched spy.
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

  it("nested calls reuse the outer run dir instead of re-bracketing", async () => {
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
    });

    const seenRunIds: string[] = [];

    await withRunLifecycle(pctx, "outer", async (outerPctx) => {
      if (outerPctx.runDir) seenRunIds.push(outerPctx.runDir.runId);
      await withRunLifecycle(outerPctx, "inner-would-be-ignored", async (innerPctx) => {
        if (innerPctx.runDir) seenRunIds.push(innerPctx.runDir.runId);
        return { isError: false };
      });
      return { isError: false };
    });

    // Both saw the outer runId — the inner call did not create a new dir.
    expect(seenRunIds).toEqual(["outer", "outer"]);
    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");
    const archive = fs.readdirSync(path.join(runRoot, "archive"));
    expect(archive.filter((n) => n.endsWith("-success"))).toHaveLength(1);
  });

  it("ensures .gitignore covers .forgeflow/run/ on first creation", async () => {
    const pctx = mockPipelineContext({
      cwd: fixture.cwdDir,
      sessionsConfig: { persist: true, archiveRuns: 20, archiveMaxAge: 30 },
    });

    await withRunLifecycle(pctx, "implement-47", async () => ({ isError: false }));

    const gitignore = fs.readFileSync(path.join(fixture.cwdDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(RUN_DIR_GITIGNORE_LINE);
  });
});
