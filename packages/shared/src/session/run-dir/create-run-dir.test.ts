import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SESSIONS } from "../../config/forgeflow-config.js";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { createRunDir } from "./index.js";

const fixture = setupIsolatedHomeFixture("run-dir-create");

function readMode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

describe("createRunDir", () => {
  it("sanitises the run id, creates the run dir at 0700, and allocates numbered 0600 session files", () => {
    const handle = createRunDir(fixture.cwdDir, "../implement 42///", DEFAULT_SESSIONS);

    expect(handle.runId).toBe("implement-42");
    expect(handle.dir).toBe(path.join(fixture.cwdDir, ".forgeflow", "run", "implement-42"));
    expect(readMode(handle.dir)).toBe(0o700);

    const first = handle.allocSessionPath("planner");
    const second = handle.allocSessionPath("architecture reviewer");

    expect(path.basename(first)).toBe("01-planner.jsonl");
    expect(path.basename(second)).toBe("02-architecture-reviewer.jsonl");
    expect(fs.existsSync(first)).toBe(true);
    expect(readMode(first)).toBe(0o600);
    expect(readMode(second)).toBe(0o600);
  });

  it("archives stale failed and marker-less interrupted runs before creating a fresh directory", () => {
    const runRoot = path.join(fixture.cwdDir, ".forgeflow", "run");

    const staleFailed = path.join(runRoot, "implement-7");
    fs.mkdirSync(staleFailed, { recursive: true });
    fs.writeFileSync(path.join(staleFailed, "outcome.json"), JSON.stringify({ outcome: "failed" }));
    fs.writeFileSync(path.join(staleFailed, "01-planner.jsonl"), "prior-run-data");

    const failedHandle = createRunDir(fixture.cwdDir, "implement-7", DEFAULT_SESSIONS);
    const archiveDir = path.join(runRoot, "archive");
    expect(fs.readdirSync(archiveDir)).toHaveLength(1);
    expect(fs.readdirSync(archiveDir)[0]).toMatch(/-implement-7-failed$/);
    expect(fs.existsSync(failedHandle.dir)).toBe(true);
    expect(fs.readdirSync(failedHandle.dir)).toEqual([]);

    const staleInterrupted = path.join(runRoot, "implement-8");
    fs.mkdirSync(staleInterrupted, { recursive: true });
    fs.writeFileSync(path.join(staleInterrupted, "01-planner.jsonl"), "crashed-run");

    createRunDir(fixture.cwdDir, "implement-8", DEFAULT_SESSIONS);

    const archivedEntries = fs.readdirSync(archiveDir);
    expect(archivedEntries).toHaveLength(2);
    expect(archivedEntries.some((entry) => entry.endsWith("-implement-8-interrupted"))).toBe(true);
  });
});
