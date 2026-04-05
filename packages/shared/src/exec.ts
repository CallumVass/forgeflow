import { spawn } from "node:child_process";

export type ExecFn = (cmd: string, cwd?: string) => Promise<string>;

/**
 * Run a shell command via bash. Returns trimmed stdout.
 * Throws on non-zero exit code or spawn error, including stderr in the message.
 */
export function exec(cmd: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-c", cmd], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed (exit ${code}): ${cmd}\n${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

/**
 * Like exec but returns empty string on failure instead of throwing.
 * Use only where failure is expected/acceptable (e.g., checking if a branch exists).
 */
export async function execSafe(cmd: string, cwd?: string): Promise<string> {
  try {
    return await exec(cmd, cwd);
  } catch {
    return "";
  }
}
