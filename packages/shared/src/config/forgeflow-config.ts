// Internal module. NOT exported from `packages/shared/package.json`'s
// `exports` map and NOT re-exported from `pipeline.ts` on purpose: config
// loading lives at a single boundary (see `toPipelineContext` in
// `runtime/pipeline-context/context.ts`). Pipelines must NOT read `forgeflow.json` themselves — they
// receive resolved per-agent overrides via `RunAgentOpts.agentOverrides`,
// which `runAgent` forwards to pi's `--model` / `--thinking` flags. Keeping
// this module physically unexported makes cross-package import a hard Node
// module resolution error, so the rule is enforced without a grep script.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Valid values for pi's `--thinking` flag. Mirrors `pi --help` output —
 * any other string in `forgeflow.json` is dropped via the loader's `warn`
 * callback and the sibling `model` field (if any) is still applied.
 */
export const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

export interface AgentConfig {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

/**
 * Sub-agent session persistence config. `persist` gates the whole feature;
 * `archiveRuns` and `archiveMaxAge` are the GC knobs (whichever trips first
 * prunes). See `session/run-dir/index.ts` for the lifecycle implementation.
 */
export interface SessionsConfig {
  persist: boolean;
  archiveRuns: number;
  archiveMaxAge: number;
}

export interface SkillsConfig {
  enabled: boolean;
  extraPaths: string[];
  maxSelected: number;
}

/**
 * Defaults for the `sessions` block when neither `~/.pi/agent/forgeflow.json`
 * nor the project `.forgeflow.json` set the field. The values are also the
 * back-fill used by `sanitiseSessions` when individual fields are invalid.
 */
export const DEFAULT_SESSIONS: SessionsConfig = {
  persist: true,
  archiveRuns: 20,
  archiveMaxAge: 30,
};

/**
 * Defaults for cross-agent skill discovery and recommendation.
 */
export const DEFAULT_SKILLS: SkillsConfig = {
  enabled: true,
  extraPaths: [],
  maxSelected: 4,
};

export interface ForgeflowConfig {
  agents?: Record<string, AgentConfig>;
  sessions?: SessionsConfig;
  skills?: SkillsConfig;
}

/** Callback invoked by the loader for every dropped value or parse error. */
type ForgeflowConfigWarn = (message: string) => void;

/**
 * Merge two forgeflow configs.
 *
 * - `agents`: project entries replace whole agent entries from global (no
 *   field-level merging inside an agent entry); non-overlapping global
 *   entries survive.
 * - `sessions`: field-level merge — a project file that sets only
 *   `archiveRuns` keeps the global `persist` and `archiveMaxAge`. This
 *   matters for sensitive-project opt-out: a global `persist: false`
 *   should not be silently re-enabled by a project that tweaks only a
 *   retention knob.
 * - `skills`: field-level merge, but `extraPaths` concatenates in
 *   global→project order so project config can add local roots without
 *   losing shared team/global ones.
 *
 * Both sides are allowed to omit either block. The returned `sessions`
 * / `skills` blocks are `undefined` when neither side supplied them;
 * `loadForgeflowConfig` back-fills defaults before returning to callers.
 */
export function mergeConfigs(global: ForgeflowConfig, project: ForgeflowConfig): ForgeflowConfig {
  const merged: ForgeflowConfig = {
    agents: {
      ...(global.agents ?? {}),
      ...(project.agents ?? {}),
    },
  };
  if (global.sessions || project.sessions) {
    merged.sessions = { ...(global.sessions ?? {}), ...(project.sessions ?? {}) } as SessionsConfig;
  }
  if (global.skills || project.skills) {
    merged.skills = {
      ...(global.skills ?? {}),
      ...(project.skills ?? {}),
      extraPaths: [...(global.skills?.extraPaths ?? []), ...(project.skills?.extraPaths ?? [])],
    } as SkillsConfig;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (VALID_THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Coerce an arbitrary `agents` field into a clean `Record<string, AgentConfig>`.
 * Drops invalid `thinkingLevel` values (with a warning), keeps the sibling
 * `model` field when present, preserves unknown agent names verbatim (the
 * consumer — `runAgent` — looks up by its own agent name, so stale entries
 * are inert).
 */
function sanitiseAgents(raw: unknown, sourceLabel: string, warn: ForgeflowConfigWarn): Record<string, AgentConfig> {
  if (!isRecord(raw)) return {};
  const out: Record<string, AgentConfig> = {};
  for (const [agentName, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    const cleaned: AgentConfig = {};
    if (typeof entry.model === "string" && entry.model.length > 0) {
      cleaned.model = entry.model;
    }
    if (entry.thinkingLevel !== undefined) {
      if (isValidThinkingLevel(entry.thinkingLevel)) {
        cleaned.thinkingLevel = entry.thinkingLevel;
      } else {
        warn(
          `forgeflow.json (${sourceLabel}): invalid thinkingLevel "${String(entry.thinkingLevel)}" for agent "${agentName}" — dropped (valid: ${VALID_THINKING_LEVELS.join(", ")})`,
        );
      }
    }
    out[agentName] = cleaned;
  }
  return out;
}

/**
 * Coerce a value to a non-negative integer (floored). Returns `undefined`
 * and emits a warning when the value is missing, non-numeric, non-finite,
 * or negative. Shared by the retention knobs in `sanitiseSessions`.
 */
function coerceNonNegInt(
  value: unknown,
  fieldLabel: string,
  sourceLabel: string,
  warn: ForgeflowConfigWarn,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  warn(`forgeflow.json (${sourceLabel}): ${fieldLabel} must be a non-negative number — dropped`);
  return undefined;
}

/**
 * Coerce a raw `sessions` block into a partial `SessionsConfig`. Individual
 * invalid fields are dropped (with a warning) — the field-level merge in
 * `mergeConfigs` + the `DEFAULT_SESSIONS` back-fill in `loadForgeflowConfig`
 * cover the hole, so a single garbage field doesn't nuke the whole block.
 *
 * Returns `undefined` when the input isn't an object at all — the caller
 * uses that to signal "file did not set sessions" to `mergeConfigs`.
 */
function sanitiseSessions(
  raw: unknown,
  sourceLabel: string,
  warn: ForgeflowConfigWarn,
): Partial<SessionsConfig> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warn(`forgeflow.json (${sourceLabel}): "sessions" must be an object — ignored`);
    return undefined;
  }
  const out: Partial<SessionsConfig> = {};
  if (raw.persist !== undefined) {
    if (typeof raw.persist === "boolean") out.persist = raw.persist;
    else warn(`forgeflow.json (${sourceLabel}): sessions.persist must be a boolean — dropped`);
  }
  if (raw.archiveRuns !== undefined) {
    const n = coerceNonNegInt(raw.archiveRuns, "sessions.archiveRuns", sourceLabel, warn);
    if (n !== undefined) out.archiveRuns = n;
  }
  if (raw.archiveMaxAge !== undefined) {
    const n = coerceNonNegInt(raw.archiveMaxAge, "sessions.archiveMaxAge", sourceLabel, warn);
    if (n !== undefined) out.archiveMaxAge = n;
  }
  return out;
}

function resolveConfigPath(value: string, filePath: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(path.dirname(filePath), value);
}

function sanitiseSkills(
  raw: unknown,
  filePath: string,
  sourceLabel: string,
  warn: ForgeflowConfigWarn,
): Partial<SkillsConfig> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warn(`forgeflow.json (${sourceLabel}): "skills" must be an object — ignored`);
    return undefined;
  }
  const out: Partial<SkillsConfig> = {};
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    else warn(`forgeflow.json (${sourceLabel}): skills.enabled must be a boolean — dropped`);
  }
  if (raw.maxSelected !== undefined) {
    const n = coerceNonNegInt(raw.maxSelected, "skills.maxSelected", sourceLabel, warn);
    if (n !== undefined) out.maxSelected = n;
  }
  if (raw.extraPaths !== undefined) {
    if (Array.isArray(raw.extraPaths) && raw.extraPaths.every((value) => typeof value === "string")) {
      out.extraPaths = raw.extraPaths
        .filter((value) => value.trim().length > 0)
        .map((value) => resolveConfigPath(value, filePath));
    } else {
      warn(`forgeflow.json (${sourceLabel}): skills.extraPaths must be an array of strings — dropped`);
    }
  }
  return out;
}

function readConfigFile(filePath: string, sourceLabel: string, warn: ForgeflowConfigWarn): ForgeflowConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { agents: {} };
    warn(`forgeflow.json (${sourceLabel}): failed to read ${filePath}: ${(err as Error).message}`);
    return { agents: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warn(`forgeflow.json (${sourceLabel}): invalid JSON at ${filePath} (${(err as Error).message}) — ignored`);
    return { agents: {} };
  }
  if (!isRecord(parsed)) return { agents: {} };
  const config: ForgeflowConfig = { agents: sanitiseAgents(parsed.agents, sourceLabel, warn) };
  const sessions = sanitiseSessions(parsed.sessions, sourceLabel, warn);
  if (sessions !== undefined) config.sessions = sessions as SessionsConfig;
  const skills = sanitiseSkills(parsed.skills, filePath, sourceLabel, warn);
  if (skills !== undefined) config.skills = skills as SkillsConfig;
  return config;
}

/**
 * Find the nearest `.forgeflow.json` by walking up from `cwd` to the
 * filesystem root. Returns the absolute path or `null` if none found.
 */
function findProjectConfigPath(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  // Walk up until we pass the root. Stop *after* checking the root itself.
  for (;;) {
    const candidate = path.join(dir, ".forgeflow.json");
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Load forgeflow config, merging the global file at
 * `~/.pi/agent/forgeflow.json` with the nearest project `.forgeflow.json`
 * walked up from `cwd` (project wins at the agent-entry level).
 *
 * Missing files are silently ignored. Malformed JSON and invalid
 * `thinkingLevel` values are reported via `warn` and dropped; the pipeline
 * still runs with inherited defaults.
 *
 * The `warn` callback is a dependency-injection seam — the default no-op
 * keeps this module pure, and the extension boundary (`toPipelineContext`)
 * routes warnings to `ctx.ui.notify(msg, "warning")`. Do NOT call
 * `console.warn` here: the rest of the codebase routes user-facing
 * notifications through `ForgeflowUI.notify`, and writing to stdout/stderr
 * corrupts the pi TUI.
 */
export function loadForgeflowConfig(cwd: string, warn: ForgeflowConfigWarn = () => {}): ForgeflowConfig {
  const globalPath = path.join(os.homedir(), ".pi", "agent", "forgeflow.json");
  const globalConfig = readConfigFile(globalPath, "global", warn);

  const projectPath = findProjectConfigPath(cwd);
  const projectConfig = projectPath ? readConfigFile(projectPath, "project", warn) : { agents: {} };

  const merged = mergeConfigs(globalConfig, projectConfig);
  // Back-fill the sessions / skills blocks last, so any field the user omitted
  // defaults to the documented values but fields they explicitly set survive.
  merged.sessions = { ...DEFAULT_SESSIONS, ...(merged.sessions ?? {}) };
  merged.skills = { ...DEFAULT_SKILLS, ...(merged.skills ?? {}), extraPaths: merged.skills?.extraPaths ?? [] };
  return merged;
}
