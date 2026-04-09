import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionsConfig } from "../config/forgeflow-config.js";
import type { ArchiveOutcome } from "./archive.js";
import { moveToArchive, readOutcomeMarker } from "./archive.js";
import { runRoot, sanitiseRunId } from "./fs.js";

/**
 * Handle returned by `createRunDir`, closed over by the session-path
 * allocator. Lives on `PipelineContext.runDir` so pipelines and helpers
 * that thread their own session paths (for example the chain-builder)
 * can allocate explicitly.
 */
export interface RunDirHandle {
  runId: string;
  /** Absolute path to `.forgeflow/run/<runId>/`. */
  dir: string;
  /**
   * Allocate the next session path. Each call increments a private
   * counter and pre-creates an empty file at `0o600` so pi's subsequent
   * `--session <path>` writes never land in a world-readable file.
   */
  allocSessionPath: (agentName: string) => string;
}

/**
 * Create `.forgeflow/run/<runId>/` at `0o700`, archiving any stale directory
 * first. A stale directory carrying a `failed`/`cancelled` outcome marker is
 * archived with that suffix; one without a marker is assumed to be an
 * interrupted run (Ctrl-C or crash) and archived with `-interrupted`.
 */
export function createRunDir(cwd: string, runId: string, _config: SessionsConfig): RunDirHandle {
  const safeId = sanitiseRunId(runId);
  const root = runRoot(cwd);
  const dir = path.join(root, safeId);

  fs.mkdirSync(root, { recursive: true });

  if (fs.existsSync(dir)) {
    const marker = readOutcomeMarker(dir);
    const outcome: ArchiveOutcome | "interrupted" =
      marker === "failed" || marker === "cancelled" ? marker : "interrupted";
    moveToArchive(cwd, dir, safeId, outcome);
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);

  let counter = 0;
  const allocSessionPath = (agentName: string): string => {
    counter += 1;
    const num = String(counter).padStart(2, "0");
    const safeName = agentName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = path.join(dir, `${num}-${safeName}.jsonl`);
    fs.writeFileSync(filePath, "", { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    return filePath;
  };

  return { runId: safeId, dir, allocSessionPath };
}
