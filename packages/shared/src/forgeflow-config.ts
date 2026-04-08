// Internal module. NOT exported from `packages/shared/package.json`'s
// `exports` map and NOT re-exported from `pipeline.ts` on purpose: config
// loading lives at a single boundary (see `toPipelineContext` in
// `context.ts`). Pipelines must NOT read `forgeflow.json` themselves — they
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

export interface ForgeflowConfig {
  agents?: Record<string, AgentConfig>;
}

/** Callback invoked by the loader for every dropped value or parse error. */
type ForgeflowConfigWarn = (message: string) => void;

/**
 * Merge two forgeflow configs. Project entries replace whole agent entries
 * from global (no field-level merging inside an agent entry); non-overlapping
 * global entries survive. Both sides are allowed to omit `agents`.
 */
export function mergeConfigs(global: ForgeflowConfig, project: ForgeflowConfig): ForgeflowConfig {
  return {
    agents: {
      ...(global.agents ?? {}),
      ...(project.agents ?? {}),
    },
  };
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
  return { agents: sanitiseAgents(parsed.agents, sourceLabel, warn) };
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

  return mergeConfigs(globalConfig, projectConfig);
}
