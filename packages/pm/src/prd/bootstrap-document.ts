import * as fs from "node:fs";
import * as path from "node:path";

export const BOOTSTRAP_FILE = path.join(".forgeflow", "BOOTSTRAP.md");

function bootstrapPath(cwd: string): string {
  return path.join(cwd, BOOTSTRAP_FILE);
}

export function bootstrapExists(cwd: string): boolean {
  return fs.existsSync(bootstrapPath(cwd));
}

export function readBootstrap(cwd: string): string {
  return fs.readFileSync(bootstrapPath(cwd), "utf-8");
}

export function writeBootstrap(cwd: string, content: string): void {
  const filePath = bootstrapPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
