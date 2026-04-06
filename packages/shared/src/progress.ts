import type { Message } from "@mariozechner/pi-ai";
import { formatToolCall } from "./display.js";
import type { OnUpdate, PipelineDetails, StageResult } from "./stages.js";

// ─── Pipeline result builder ──────────────────────────────────────────

export type PipelineResult = {
  content: [{ type: "text"; text: string }];
  details: PipelineDetails;
  isError?: true;
};

export function pipelineResult(
  text: string,
  pipeline: string,
  stages: StageResult[],
  isError?: boolean,
): PipelineResult {
  return {
    content: [{ type: "text", text }],
    details: { pipeline, stages },
    ...(isError ? { isError: true as const } : {}),
  };
}

// ─── Progress ─────────────────────────────────────────────────────────

/** Format the last tool call in messages as a short plain-text display string. */
export function getLastToolCall(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const msg = messages[i]!;
    if (msg.role === "assistant") {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const part = msg.content[j];
        if (part?.type === "toolCall") {
          const name = part.name;
          const args = (part.arguments ?? {}) as Record<string, unknown>;
          return formatToolCall(name, args);
        }
      }
    }
  }
  return "";
}

/** Emit a progress update for the current pipeline state. */
export function emitUpdate(options: { stages: StageResult[]; pipeline: string; onUpdate?: OnUpdate }): void {
  if (!options.onUpdate) return;
  const running = options.stages.find((s) => s.status === "running");
  let text: string;
  if (running) {
    const lastTool = getLastToolCall(running.messages);
    text = lastTool ? `[${running.name}] ${lastTool}` : `[${running.name}] running...`;
  } else {
    text = options.stages.every((s) => s.status === "done") ? "Pipeline complete" : "Processing...";
  }
  options.onUpdate(pipelineResult(text, options.pipeline, options.stages));
}
