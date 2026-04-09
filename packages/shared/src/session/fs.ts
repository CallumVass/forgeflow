import * as fs from "node:fs";
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
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "run";
}

/**
 * Ensure `.gitignore` at the repo root covers `.forgeflow/run/`. Idempotent:
 * if the file already contains a matching line, this is a no-op. If the
 * file is missing or the line is absent, append and fire `log` once.
 *
 * Called eagerly on first creation of `.forgeflow/run/` because session
 * files can contain literal secrets the agent read from disk, the cost
 * of a false-negative here is committed .env contents.
 */
export function ensureGitignore(cwd: string, log: (msg: string) => void = () => {}): void {
  const gitignorePath = path.join(cwd, ".gitignore");
  let contents = "";
  let exists = false;
  try {
    contents = fs.readFileSync(gitignorePath, "utf-8");
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }

  // Cheap substring check, users can write `.forgeflow/run/` or
  // `/.forgeflow/run/` or `.forgeflow/run/*`, all of which cover us.
  const covered = contents.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return (
      trimmed === RUN_DIR_GITIGNORE_LINE ||
      trimmed === `/${RUN_DIR_GITIGNORE_LINE}` ||
      trimmed === ".forgeflow/run" ||
      trimmed === ".forgeflow/" ||
      trimmed === ".forgeflow"
    );
  });
  if (covered) return;

  const toWrite = exists
    ? `${contents.endsWith("\n") ? contents : `${contents}\n`}${RUN_DIR_GITIGNORE_LINE}\n`
    : `${RUN_DIR_GITIGNORE_LINE}\n`;
  try {
    fs.writeFileSync(gitignorePath, toWrite);
    log(`forgeflow: appended "${RUN_DIR_GITIGNORE_LINE}" to .gitignore (session files may contain secrets)`);
  } catch {
    // Fail-soft: if we can't write, we still want the pipeline to run.
  }
}
