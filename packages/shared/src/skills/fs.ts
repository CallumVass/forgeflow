import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function safeRealpath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function findRepoRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  for (;;) {
    if (fileExists(path.join(dir, ".git"))) return dir;
    if (dir === root) return path.resolve(cwd);
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

export function collectAncestors(cwd: string, boundary: string): string[] {
  const out: string[] = [];
  let dir = path.resolve(cwd);
  const stop = path.resolve(boundary);
  for (;;) {
    out.push(dir);
    if (dir === stop) return out;
    const parent = path.dirname(dir);
    if (parent === dir) return out;
    dir = parent;
  }
}
