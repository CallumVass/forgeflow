import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanSignal, readSignal, SIGNALS, signalExists } from "./signals.js";

describe("signal functions", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("signalExists / readSignal / cleanSignal lifecycle", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-test-"));
    const filePath = path.join(tmpDir, SIGNALS.blocked);
    fs.writeFileSync(filePath, "blocked reason");

    expect(signalExists(tmpDir, "blocked")).toBe(true);
    expect(readSignal(tmpDir, "blocked")).toBe("blocked reason");

    cleanSignal(tmpDir, "blocked");
    expect(signalExists(tmpDir, "blocked")).toBe(false);
    expect(readSignal(tmpDir, "blocked")).toBeNull();
  });

  it("readSignal returns null for missing signal", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-test-"));
    expect(readSignal(tmpDir, "findings")).toBeNull();
    expect(signalExists(tmpDir, "findings")).toBe(false);
  });
});
