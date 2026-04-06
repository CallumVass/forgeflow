import type { Message } from "@mariozechner/pi-ai";
import type { StageResult } from "./stage.js";

/** Parse a single NDJSON line into a structured event. Returns null for unparseable lines. */
export function parseMessageLine(line: string): { type: string; message?: Message } | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as { type: string; message?: Message };
  } catch {
    return null;
  }
}

/** Apply a parsed message event to a stage, accumulating usage stats. Returns true if stage was updated. */
export function applyMessageToStage(event: { type?: string; message?: Message }, stage: StageResult): boolean {
  if (event.type === "message_end" && event.message) {
    const msg = event.message;
    stage.messages.push(msg);
    if (msg.role === "assistant") {
      stage.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        stage.usage.input += usage.input || 0;
        stage.usage.output += usage.output || 0;
        stage.usage.cacheRead += usage.cacheRead || 0;
        stage.usage.cacheWrite += usage.cacheWrite || 0;
        stage.usage.cost += usage.cost?.total || 0;
      }
      if (!stage.model && msg.model) stage.model = msg.model;
    }
    return true;
  }
  if (event.type === "tool_result_end" && event.message) {
    stage.messages.push(event.message);
    return true;
  }
  return false;
}

/** Walk assistant messages backwards to extract the last text block. */
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

/** Extract final text output from a stage's messages. */
export function extractFinalOutput(stage: StageResult): void {
  stage.output = getFinalOutput(stage.messages);
}
