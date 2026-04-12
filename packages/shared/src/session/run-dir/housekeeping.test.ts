import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { ensureGitignore, gcArchive, RUN_DIR_GITIGNORE_LINE } from "./index.js";

const fixture = setupIsolatedHomeFixture("run-dir-housekeeping");

describe("run-dir housekeeping", () => {
  it("appends the run-dir gitignore rule once and stays idempotent when coverage already exists", () => {
    const gitignorePath = path.join(fixture.cwdDir, ".gitignore");
    const log = vi.fn();

    ensureGitignore(fixture.cwdDir, log);
    const firstContents = fs.readFileSync(gitignorePath, "utf-8");
    expect(firstContents).toContain(RUN_DIR_GITIGNORE_LINE);
    expect(log).toHaveBeenCalledTimes(1);

    log.mockClear();
    ensureGitignore(fixture.cwdDir, log);
    expect(fs.readFileSync(gitignorePath, "utf-8")).toBe(firstContents);
    expect(log).not.toHaveBeenCalled();

    fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n");
    ensureGitignore(fixture.cwdDir, log);
    expect(fs.readFileSync(gitignorePath, "utf-8")).toContain(RUN_DIR_GITIGNORE_LINE);
  });

  it("prunes archived runs by max age and then keeps only the newest archiveRuns entries", () => {
    const archiveDir = path.join(fixture.cwdDir, ".forgeflow", "run", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });

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
    const recentBase = now - 4 * day;
    for (const [i, name] of names.entries()) {
      const target = path.join(archiveDir, name);
      if (i < 2) {
        const stale = new Date(now - 30 * day);
        fs.utimesSync(target, stale, stale);
      } else {
        const time = new Date(recentBase + i * 60_000);
        fs.utimesSync(target, time, time);
      }
    }

    gcArchive(fixture.cwdDir, { persist: true, archiveRuns: 3, archiveMaxAge: 5 });

    expect(fs.readdirSync(archiveDir).sort()).toEqual([
      "20240101-000003-run-4-success",
      "20240101-000004-run-5-success",
      "20240101-000005-run-6-success",
    ]);
  });
});
