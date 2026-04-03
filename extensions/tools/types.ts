import type { Message } from "@mariozechner/pi-ai";

// biome-ignore lint/suspicious/noExplicitAny: opaque type for untyped external boundaries
export type AnyCtx = any;

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
