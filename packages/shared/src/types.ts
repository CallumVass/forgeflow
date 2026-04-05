import type { AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

/** Subset of ExtensionUIContext that forgeflow actually uses. */
export interface ForgeflowUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, content: string): Promise<string | undefined>;
  select(title: string, options: string[]): Promise<string | undefined>;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined): void;
}

/** What forgeflow actually needs from the extension context. */
export interface ForgeflowContext {
  hasUI: boolean;
  cwd: string;
  ui: ForgeflowUI;
}

/** Structural theme interface — subset of Pi's Theme class used by rendering. */
export interface ForgeflowTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

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

/** The 4 arguments that appear in every pipeline function, bundled as one object. */
export interface PipelineContext {
  cwd: string;
  signal: AbortSignal;
  onUpdate: OnUpdate | undefined;
  ctx: ForgeflowContext;
}

/** Convert a PipelineContext + pipeline-specific extras into RunAgentOpts. */
export function toAgentOpts(
  pctx: PipelineContext,
  extra: { agentsDir: string; stages: StageResult[]; pipeline: string },
): RunAgentOpts {
  return {
    cwd: pctx.cwd,
    signal: pctx.signal,
    onUpdate: pctx.onUpdate,
    ...extra,
  };
}

export type RunAgentOpts = {
  agentsDir: string;
  cwd: string;
  tools?: string[];
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

export function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const msg = messages[i]!;
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
          return part.text as string;
        }
      }
    }
  }
  return "";
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
