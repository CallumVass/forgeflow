import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SESSIONS } from "../../config/forgeflow-config.js";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import { archiveRunDir, createRunDir } from "./index.js";

const fixture = setupIsolatedHomeFixture("run-dir-archive");

describe("archiveRunDir", () => {
  it("moves successful and cancelled runs under archive/<ts>-<runId>-<outcome>", () => {
    const successHandle = createRunDir(fixture.cwdDir, "run-a", DEFAULT_SESSIONS);
    fs.writeFileSync(successHandle.allocSessionPath("planner"), "success-session");

    archiveRunDir(fixture.cwdDir, successHandle, "success");

    const archiveDir = path.join(fixture.cwdDir, ".forgeflow", "run", "archive");
    expect(fs.existsSync(successHandle.dir)).toBe(false);
    expect(fs.readdirSync(archiveDir)[0]).toMatch(/-run-a-success$/);

    const cancelledHandle = createRunDir(fixture.cwdDir, "run-b", DEFAULT_SESSIONS);
    cancelledHandle.allocSessionPath("planner");

    archiveRunDir(fixture.cwdDir, cancelledHandle, "cancelled");

    expect(fs.existsSync(cancelledHandle.dir)).toBe(false);
    expect(fs.readdirSync(archiveDir).some((entry) => entry.endsWith("-run-b-cancelled"))).toBe(true);
  });

  it("leaves failed runs in place and writes an outcome marker for stale-run recovery", () => {
    const failedHandle = createRunDir(fixture.cwdDir, "run-c", DEFAULT_SESSIONS);
    failedHandle.allocSessionPath("planner");

    archiveRunDir(fixture.cwdDir, failedHandle, "failed");

    expect(fs.existsSync(failedHandle.dir)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(path.join(failedHandle.dir, "outcome.json"), "utf-8"));
    expect(marker.outcome).toBe("failed");
  });
});
