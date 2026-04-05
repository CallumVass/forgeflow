import type { Message } from "@mariozechner/pi-ai";
import type { OnUpdate, StageResult } from "./types.js";

/** Format the last tool call in messages as a short plain-text display string. */
// See also: rendering.ts#formatToolCallShort (coloured variant)
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
          return formatToolCallPlain(name, args);
        }
      }
    }
  }
  return "";
}

// See also: rendering.ts#formatToolCallShort (coloured variant)
function formatToolCallPlain(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "bash": {
      const cmd = ((args.command as string) || "").slice(0, 60);
      return cmd ? `$ ${cmd}` : name;
    }
    case "read":
    case "write":
    case "edit":
      return `${name} ${(args.file_path ?? args.path ?? "") as string}`;
    case "grep":
      return `grep /${(args.pattern as string) ?? ""}/`;
    case "find":
      return `find ${(args.pattern as string) ?? ""}`;
    default:
      return name;
  }
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
  options.onUpdate({
    content: [{ type: "text", text }],
    details: { pipeline: options.pipeline, stages: options.stages },
  });
}
