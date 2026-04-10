import * as fs from "node:fs";
import * as path from "node:path";
import { RUN_DIR_GITIGNORE_LINE } from "./paths.js";

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
