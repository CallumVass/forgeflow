import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionsConfig } from "../config/forgeflow-config.js";
import type { RunDirHandle } from "./create.js";
import { archiveRoot } from "./fs.js";

/** Marker file written on `failed` outcome so a subsequent run can archive it correctly. */
const OUTCOME_MARKER = "outcome.json";

export type ArchiveOutcome = "success" | "failed" | "cancelled";

/**
 * Filesystem-safe timestamp used as the archive prefix: `YYYYMMDD-HHmmss`.
 * No colons, the path is portable if the repo is ever cloned on Windows.
 */
function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function readOutcomeMarker(dir: string): ArchiveOutcome | null {
  try {
    const raw = fs.readFileSync(path.join(dir, OUTCOME_MARKER), "utf-8");
    const parsed = JSON.parse(raw) as { outcome?: unknown };
    if (parsed.outcome === "failed" || parsed.outcome === "success" || parsed.outcome === "cancelled") {
      return parsed.outcome;
    }
  } catch {}
  return null;
}

/**
 * Rename a run directory under `archive/<ts>-<runId>-<outcome>/`.
 *
 * Best-effort: failures are swallowed so neither a new run nor a pipeline
 * tear-down is blocked by a flaky rename (cross-device, permissions, ...).
 */
export function moveToArchive(cwd: string, dir: string, runId: string, outcome: ArchiveOutcome | "interrupted"): void {
  try {
    const root = archiveRoot(cwd);
    fs.mkdirSync(root, { recursive: true });
    const target = path.join(root, `${archiveTimestamp()}-${runId}-${outcome}`);
    fs.renameSync(dir, target);
  } catch {
    // If the rename fails (cross-device, permissions), just leave the
    // directory in place. We should not block a fresh run, and a stale
    // dir will be picked up as `-interrupted` on the next createRunDir.
  }
}

/**
 * Close out a run directory based on the pipeline outcome.
 *
 * - `success` / `cancelled`: rename under `archive/<ts>-<runId>-<outcome>/`.
 * - `failed`: leave the directory in place and write an `outcome.json`
 *   marker so the next run with the same runId can archive it as `-failed`
 *   (the user will want to `pi --resume` it meanwhile).
 */
export function archiveRunDir(cwd: string, handle: RunDirHandle, outcome: ArchiveOutcome): void {
  if (!fs.existsSync(handle.dir)) return;

  if (outcome === "failed") {
    try {
      fs.writeFileSync(
        path.join(handle.dir, OUTCOME_MARKER),
        JSON.stringify({ outcome: "failed", timestamp: new Date().toISOString() }),
        { mode: 0o600 },
      );
    } catch {
      // Non-fatal: absence of the marker will show up as -interrupted on
      // the next run, which is a reasonable fallback.
    }
    return;
  }

  moveToArchive(cwd, handle.dir, handle.runId, outcome);
}

/**
 * Prune archived run directories under `.forgeflow/run/archive/` so that
 * at most `archiveRuns` entries remain and nothing older than
 * `archiveMaxAge` days survives.
 */
export function gcArchive(cwd: string, config: SessionsConfig): void {
  const root = archiveRoot(cwd);
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }

  const now = Date.now();
  const maxAgeMs = config.archiveMaxAge * 24 * 60 * 60 * 1000;

  type Entry = { name: string; mtimeMs: number };
  const stats: Entry[] = [];
  for (const name of entries) {
    try {
      const st = fs.statSync(path.join(root, name));
      if (!st.isDirectory()) continue;
      stats.push({ name, mtimeMs: st.mtimeMs });
    } catch {}
  }

  const fresh: Entry[] = [];
  for (const entry of stats) {
    if (now - entry.mtimeMs > maxAgeMs) {
      try {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      } catch {}
    } else {
      fresh.push(entry);
    }
  }

  fresh.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of fresh.slice(config.archiveRuns)) {
    try {
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
    } catch {}
  }
}
