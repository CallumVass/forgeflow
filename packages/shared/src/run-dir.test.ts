import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSIONS } from "./forgeflow-config.js";
import { archiveRunDir, createRunDir, ensureGitignore, gcArchive, RUN_DIR_GITIGNORE_LINE } from "./run-dir.js";
import { setupIsolatedHomeFixture } from "./test-utils.js";

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
