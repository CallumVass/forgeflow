import * as path from "node:path";

/** Line that `ensureGitignore` writes into `.gitignore`. */
export const RUN_DIR_GITIGNORE_LINE = ".forgeflow/run/";

export function runRoot(cwd: string): string {
  return path.join(cwd, ".forgeflow", "run");
}

export function archiveRoot(cwd: string): string {
  return path.join(runRoot(cwd), "archive");
}

/**
 * Sanitise a runId so it is always a safe single path segment. The runId
 * reaches this module from pipelines that may build it from arbitrary user
 * input (issue numbers, branch names, PR targets), strip anything that
 * could escape the directory layout.
 */
export function sanitiseRunId(runId: string): string {
  const cleaned = runId
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "run";
}
