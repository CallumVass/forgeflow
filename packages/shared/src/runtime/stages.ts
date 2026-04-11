import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "../config/forgeflow-config.js";
import type { SelectedSkill } from "../skills/index.js";

// ─── Agents directory ─────────────────────────────────────────────────

/**
 * Resolve the agents directory relative to the calling package's
 * compiled entry point.  Each package passes its own `import.meta.url`
 * so the path is anchored to the right bundle output.
 */
export function resolveAgentsDir(importMetaUrl: string): string {
  const dir = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(dir, "..", "agents");
}

// ─── Stage types and helpers ──────────────────────────────────────────

/** Concrete callback type for pipeline update notifications. */
export type OnUpdate = AgentToolUpdateCallback<PipelineDetails>;

export interface StageResult {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  messages: Message[];
  exitCode: number;
  stderr: string;
  output: string;
  usage: UsageStats;
  model?: string;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface PipelineDetails {
  pipeline: string;
  stages: StageResult[];
}

export function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

export type RunAgentOpts = {
  agentsDir: string;
  cwd: string;
  signal?: AbortSignal;
  stages: StageResult[];
  pipeline: string;
  onUpdate?: OnUpdate;
  stageName?: string;
  /**
   * Per-agent model / thinking overrides, resolved once at the
   * `toPipelineContext` boundary from `.forgeflow.json` +
   * `~/.pi/agent/forgeflow.json`. Keyed by the raw agent file stem
   * (e.g. `"planner"`, `"implementor"`), NOT `stageName`.
   */
  agentOverrides?: Record<string, AgentConfig>;
  /**
   * Skills explicitly shortlisted for this sub-agent run. `runAgent` forwards
   * them via repeated `--skill <path>` flags and appends system guidance so the
   * agent reads the selected `SKILL.md` files in place.
   */
  selectedSkills?: SelectedSkill[];
  /**
   * Path of the session JSONL file this sub-agent should write to.
   * Set by `withRunLifecycle` (auto-allocated per call) or by the
   * chain-builder (explicitly, to thread forks). When absent,
   * `runAgent` falls back to `--no-session` so ephemeral callers
   * still work.
   */
  sessionPath?: string;
  /**
   * When set, spawn the sub-agent as `pi --fork <forkFrom>`, inheriting
   * the source session's conversation history as prior tool results and
   * assistant turns. The sub-agent still writes to its own
   * `sessionPath` — fork and session paths are orthogonal and both may
   * be supplied. Used by the chain-builder to share context across
   * build-chain phases.
   */
  forkFrom?: string;
};

export type RunAgentFn = (agent: string, prompt: string, opts: RunAgentOpts) => Promise<StageResult>;

export function emptyStage(name: string): StageResult {
  return {
    name,
    status: "pending",
    messages: [],
    exitCode: -1,
    stderr: "",
    output: "",
    usage: emptyUsage(),
  };
}

export function sumUsage(stages: StageResult[]): UsageStats {
  const total = emptyUsage();
  for (const s of stages) {
    total.input += s.usage.input;
    total.output += s.usage.output;
    total.cacheRead += s.usage.cacheRead;
    total.cacheWrite += s.usage.cacheWrite;
    total.cost += s.usage.cost;
    total.turns += s.usage.turns;
  }
  return total;
}
