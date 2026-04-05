import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exec, execSafe } from "./exec.js";

describe("exec", () => {
  it("returns trimmed stdout from a successful command", async () => {
    const result = await exec("echo '  hello world  '");
    expect(result).toBe("hello world");
  });

  it("rejects with exit code and stderr when command exits non-zero", async () => {
    await expect(exec("echo fail >&2; exit 1")).rejects.toThrow(/exit 1/);
    await expect(exec("echo fail >&2; exit 1")).rejects.toThrow(/fail/);
  });

  it("rejects on spawn error (invalid cwd)", async () => {
    await expect(exec("echo hi", "/nonexistent-dir-abc123")).rejects.toThrow();
  });

  it("passes cwd to the spawned process", async () => {
    const result = await exec("pwd", "/tmp");
    expect(result).toMatch(/\/tmp/);
  });
});

describe("execSafe", () => {
  it("returns empty string on non-zero exit instead of throwing", async () => {
    const result = await execSafe("exit 1");
    expect(result).toBe("");
  });

  it("returns trimmed stdout on success", async () => {
    const result = await execSafe("echo ok");
    expect(result).toBe("ok");
  });
});

describe("shared index exports", () => {
  it("exports exec, execSafe, and ExecFn from the package index", async () => {
    const indexSrc = readFileSync(resolve(__dirname, "index.ts"), "utf-8");
    expect(indexSrc).toContain("exec");
    expect(indexSrc).toContain("execSafe");
    expect(indexSrc).toContain("ExecFn");
  });
});

describe("migration verification", () => {
  it("packages/dev/src/utils/exec.ts no longer exists", () => {
    expect(() => {
      readFileSync(resolve(__dirname, "../../dev/src/utils/exec.ts"), "utf-8");
    }).toThrow();
  });

  it("confluence.ts contains no execCmd function definition", () => {
    const src = readFileSync(resolve(__dirname, "confluence.ts"), "utf-8");
    expect(src).not.toContain("function execCmd");
  });

  it("all dev importers reference @callumvass/forgeflow-shared for exec", () => {
    const files = [
      resolve(__dirname, "../../dev/src/pipelines/review.ts"),
      resolve(__dirname, "../../dev/src/pipelines/implement-all.ts"),
      resolve(__dirname, "../../dev/src/utils/git.ts"),
      resolve(__dirname, "../../dev/src/utils/git-workflow.ts"),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src).not.toContain('from "../utils/exec.js"');
      expect(src).not.toContain('from "./exec.js"');
      expect(src).toContain("@callumvass/forgeflow-shared");
    }
  });

  it("git-workflow.ts imports ExecFn from shared and has no local definition", () => {
    const src = readFileSync(resolve(__dirname, "../../dev/src/utils/git-workflow.ts"), "utf-8");
    expect(src).toContain("@callumvass/forgeflow-shared");
    expect(src).toContain("ExecFn");
    expect(src).not.toContain("export type ExecFn");
  });
});
