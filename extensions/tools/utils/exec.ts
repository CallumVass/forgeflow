import { spawn } from "node:child_process";

export function exec(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", cmd], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.on("close", () => resolve(out.trim()));
    proc.on("error", () => resolve(""));
  });
}
