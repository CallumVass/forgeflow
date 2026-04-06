import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLS_ALL = ["read", "write", "edit", "bash", "grep", "find"];
export const TOOLS_READONLY = ["read", "bash", "grep", "find"];
export const TOOLS_NO_EDIT = ["read", "write", "bash", "grep", "find"];

export const SIGNALS = {
  questions: "QUESTIONS.md",
  findings: "FINDINGS.md",
  blocked: "BLOCKED.md",
} as const;

/**
 * Resolve the agents directory relative to the calling package's
 * compiled entry point.  Each package passes its own `import.meta.url`
 * so the path is anchored to the right bundle output.
 */
export function resolveAgentsDir(importMetaUrl: string): string {
  const dir = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(dir, "..", "agents");
}
