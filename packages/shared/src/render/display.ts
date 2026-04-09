import type { Message } from "@mariozechner/pi-ai";

export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

export function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
      }
    }
  }
  return items;
}

/** Return the last `n` tool calls from a message history, in chronological order. */
export function getLastToolCalls(
  messages: Message[],
  n: number,
): Array<{ name: string; args: Record<string, unknown> }> {
  if (n <= 0) return [];
  const tools: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const item of getDisplayItems(messages)) {
    if (item.type === "toolCall") tools.push({ name: item.name, args: item.args });
  }
  return tools.slice(-n);
}

type Colorise = (colour: string, text: string) => string;
const plain: Colorise = (_colour, text) => text;

export function formatToolCall(name: string, args: Record<string, unknown>, fg: Colorise = plain): string {
  switch (name) {
    case "bash": {
      const cmd = ((args.command as string) || "").slice(0, 60);
      const ellipsis = ((args.command as string) || "").length > 60 ? "..." : "";
      const display = cmd || "...";
      return fg("muted", "$ ") + fg("toolOutput", display + ellipsis);
    }
    case "read":
    case "write":
    case "edit":
      return fg("muted", `${name} `) + fg("accent", (args.file_path || args.path || "...") as string);
    case "grep":
      return fg("muted", "grep ") + fg("accent", `/${args.pattern || ""}/`);
    case "find":
      return fg("muted", "find ") + fg("accent", (args.pattern || "*") as string);
    default:
      return fg("accent", name);
  }
}

export function formatUsage(
  usage: { input: number; output: number; cost: number; turns: number },
  model?: string,
): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns}t`);
  if (usage.input) parts.push(`↑${usage.input < 1000 ? usage.input : `${Math.round(usage.input / 1000)}k`}`);
  if (usage.output) parts.push(`↓${usage.output < 1000 ? usage.output : `${Math.round(usage.output / 1000)}k`}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}
