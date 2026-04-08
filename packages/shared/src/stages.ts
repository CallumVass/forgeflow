import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

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
