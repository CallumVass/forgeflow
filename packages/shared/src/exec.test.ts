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

