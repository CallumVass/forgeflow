// Run directory lifecycle for sub-agent session files.
//
// Pipelines call `withRunLifecycle` at their top entry point to bracket
// a run: it creates `.forgeflow/run/<runId>/`, runs the pipeline body
// with that directory attached to `PipelineContext.runDir`, and archives
// the directory based on the result's `isError` flag.
//
// Pipelines must NOT call `createRunDir` / `archiveRunDir` directly —
// that coupling lives in `withRunLifecycle` only. They interact with
// run directories implicitly through a patched `runAgentFn` that
// auto-allocates a session file per sub-agent call, and explicitly
// through `pctx.runDir?.allocSessionPath(agent)` when a caller (e.g.
// the chain-builder) needs to thread session paths between phases.
//
// See issue #127 and `.forgeflow/run/` in `.gitignore`.

import * as fs from "node:fs";
import * as path from "node:path";
import type { PipelineContext } from "./context.js";
import type { SessionsConfig } from "./forgeflow-config.js";
import type { RunAgentFn } from "./stages.js";

/** Line that `ensureGitignore` writes into `.gitignore`. */
export const RUN_DIR_GITIGNORE_LINE = ".forgeflow/run/";

/** Marker file written on `failed` outcome so a subsequent run can archive it correctly. */
const OUTCOME_MARKER = "outcome.json";

/**
 * Outcomes recognised by the lifecycle. `interrupted` is implicit — see
 * `createRunDir`. Not re-exported: consumers that need the outcome type
 * should take a `ReturnType<typeof archiveRunDir>`-shaped string, or this
 * module should add an `export` once the pipeline wiring lands.
 */
export type ArchiveOutcome = "success" | "failed" | "cancelled";

/**
 * Handle returned by `createRunDir`; closed over by the session-path
 * allocator. Lives on `PipelineContext.runDir` so pipelines and helpers
 * that thread their own session paths (e.g. the chain-builder) can
 * allocate explicitly.
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

// ─── Filesystem helpers ───────────────────────────────────────────────

function runRoot(cwd: string): string {
  return path.join(cwd, ".forgeflow", "run");
}

function archiveRoot(cwd: string): string {
  return path.join(runRoot(cwd), "archive");
}

/**
 * Filesystem-safe timestamp used as the archive prefix: `YYYYMMDD-HHmmss`.
 * No colons — the path is portable if the repo is ever cloned on Windows.
 * Exported via parameter override for deterministic tests (see helper below).
 */
function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * Sanitise a runId so it is always a safe single path segment. The runId
 * reaches this module from pipelines that may build it from arbitrary user
 * input (issue numbers, branch names, PR targets) — strip anything that
 * could escape the directory layout.
 */
function sanitiseRunId(runId: string): string {
  const cleaned = runId
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "run";
}

function readOutcomeMarker(dir: string): ArchiveOutcome | null {
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
 * Rename a run directory under `archive/<ts>-<runId>-<outcome>/`. Shared by
 * the stale-dir cleanup in `createRunDir` and the success/cancelled branch
 * of `archiveRunDir` — both paths have identical rename semantics.
 *
 * Best-effort: failures are swallowed so neither a new run nor a pipeline
 * tear-down is blocked by a flaky rename (cross-device, permissions, …).
 */
function moveToArchive(cwd: string, dir: string, runId: string, outcome: ArchiveOutcome | "interrupted"): void {
  try {
    const root = archiveRoot(cwd);
    fs.mkdirSync(root, { recursive: true });
    const target = path.join(root, `${archiveTimestamp()}-${runId}-${outcome}`);
    fs.renameSync(dir, target);
  } catch {
    // If the rename fails (cross-device, permissions), just leave the
    // directory in place — we should not block a fresh run, and a stale
    // dir will be picked up as `-interrupted` on the next createRunDir.
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Create `.forgeflow/run/<runId>/` at `0o700`, archiving any stale directory
 * first. A stale directory carrying a `failed`/`cancelled` outcome marker is
 * archived with that suffix; one without a marker is assumed to be an
 * interrupted run (Ctrl-C or crash) and archived with `-interrupted`.
 *
 * The returned handle exposes a monotonic `allocSessionPath(agentName)` that
 * yields `NN-<agent>.jsonl` paths and pre-creates each file at `0o600`.
 *
 * Callers should run `gcArchive` *before* calling this helper, so that
 * retention limits apply at pipeline entry per the spec.
 */
export function createRunDir(cwd: string, runId: string, _config: SessionsConfig): RunDirHandle {
  const safeId = sanitiseRunId(runId);
  const root = runRoot(cwd);
  const dir = path.join(root, safeId);

  fs.mkdirSync(root, { recursive: true });

  if (fs.existsSync(dir)) {
    const marker = readOutcomeMarker(dir);
    // marker === 'success' shouldn't happen (success archives immediately),
    // but fall through to `interrupted` on any unexpected state.
    const outcome: ArchiveOutcome | "interrupted" =
      marker === "failed" || marker === "cancelled" ? marker : "interrupted";
    moveToArchive(cwd, dir, safeId, outcome);
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // `mkdir`'s `mode` is masked by process.umask(), so re-apply explicitly.
  fs.chmodSync(dir, 0o700);

  let counter = 0;
  const allocSessionPath = (agentName: string): string => {
    counter += 1;
    const num = String(counter).padStart(2, "0");
    const safeName = agentName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = path.join(dir, `${num}-${safeName}.jsonl`);
    // Pre-create with 0o600 so pi writes land in a private file.
    fs.writeFileSync(filePath, "", { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    return filePath;
  };

  return { runId: safeId, dir, allocSessionPath };
}

/**
 * Close out a run directory based on the pipeline outcome.
 *
 * - `success` / `cancelled`: rename under `archive/<ts>-<runId>-<outcome>/`.
 * - `failed`: leave the directory in place and write an `outcome.json`
 *   marker so the next run with the same runId can archive it as `-failed`
 *   (the user will want to `pi --resume` it meanwhile).
 *
 * Interruptions (Ctrl-C, crashes) never reach this function — they are
 * detected on the next `createRunDir` call by the absence of a marker.
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
 * `archiveMaxAge` days survives. Both knobs compose — whichever trips
 * first takes the entry.
 *
 * Best-effort: any rm failure is swallowed so a bad archive entry cannot
 * block a new run from starting.
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

  // Age-prune first so the count-prune sees only fresh entries.
  const aged: Entry[] = [];
  for (const e of stats) {
    if (now - e.mtimeMs > maxAgeMs) {
      try {
        fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
      } catch {}
    } else {
      aged.push(e);
    }
  }

  // Sort newest first, then drop anything beyond `archiveRuns`.
  aged.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const e of aged.slice(config.archiveRuns)) {
    try {
      fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Ensure `.gitignore` at the repo root covers `.forgeflow/run/`. Idempotent:
 * if the file already contains a matching line, this is a no-op. If the
 * file is missing or the line is absent, append and fire `log` once.
 *
 * Called eagerly on first creation of `.forgeflow/run/` because session
 * files can contain literal secrets the agent read from disk — the cost
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

  // Cheap substring check — users can write `.forgeflow/run/` or
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

// ─── Lifecycle wrapper ────────────────────────────────────

/** Minimal pipeline result shape inspected by `withRunLifecycle`. */
interface LifecycleResult {
  isError?: boolean;
}

/**
 * Bracket a pipeline run with a `.forgeflow/run/<runId>/` directory.
 *
 * Behaviour:
 * - If `pctx.runDir` is already set, this is a nested call — run the
 *   body with the existing context and do not re-bracket. This lets
 *   `runImplementAll` wrap the outer run and nest `runImplement` calls
 *   without stomping on the parent's lifecycle.
 * - If `pctx.sessionsConfig?.persist` is false (or the config block is
 *   missing), run the body with the context unchanged. Pipelines fall
 *   back to `--no-session` behaviour for sensitive projects.
 * - Otherwise: run gitignore + GC housekeeping, create the run dir,
 *   patch `runAgentFn` so every sub-agent call auto-allocates a
 *   per-stage session file (unless the caller supplied `sessionPath`
 *   explicitly, e.g. via the chain-builder), then archive the run dir
 *   based on the result's `isError` flag (or on an unhandled throw).
 *
 * The `run` callback receives a derived context carrying both `runDir`
 * and the patched `runAgentFn`. Pipelines must call back through that
 * context; using a captured outer `pctx` bypasses the wiring.
 */
export async function withRunLifecycle<T extends LifecycleResult>(
  pctx: PipelineContext,
  runId: string,
  run: (pctx: PipelineContext) => Promise<T>,
): Promise<T> {
  // Nested call — the outer lifecycle owns the directory; do nothing.
  if (pctx.runDir) return run(pctx);

  const config = pctx.sessionsConfig;
  if (!config?.persist) return run(pctx);

  ensureGitignore(pctx.cwd, (msg) => pctx.ctx.ui.notify(msg, "info"));
  gcArchive(pctx.cwd, config);

  const handle = createRunDir(pctx.cwd, runId, config);

  // Patch `runAgentFn` so call sites that do not supply `sessionPath`
  // automatically get a per-stage session file. Explicit `sessionPath`
  // or `forkFrom` from callers (the chain-builder) passes through
  // untouched so fork lineages can be threaded deterministically.
  const baseRunAgent = pctx.runAgentFn;
  const wrappedRunAgent: RunAgentFn = (agent, prompt, opts) => {
    if (opts.sessionPath || opts.forkFrom) return baseRunAgent(agent, prompt, opts);
    const label = opts.stageName ?? agent;
    const sessionPath = handle.allocSessionPath(label);
    return baseRunAgent(agent, prompt, { ...opts, sessionPath });
  };

  const innerPctx: PipelineContext = {
    ...pctx,
    runDir: handle,
    runAgentFn: wrappedRunAgent,
  };

  try {
    const result = await run(innerPctx);
    archiveRunDir(pctx.cwd, handle, result?.isError ? "failed" : "success");
    return result;
  } catch (err) {
    archiveRunDir(pctx.cwd, handle, "failed");
    throw err;
  }
}
