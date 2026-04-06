import { describe, expect, it } from "vitest";
import { formatToolCall, formatUsage, getDisplayItems } from "./display.js";

describe("getDisplayItems", () => {
  it("extracts text and toolCall items from assistant messages, ignoring others", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "ignored" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          { type: "toolCall", name: "bash", arguments: { command: "ls" } },
          { type: "image", url: "ignored" },
        ],
      },
      { role: "system", content: [{ type: "text", text: "also ignored" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "world" }],
      },
    ];

    const items = getDisplayItems(messages);
    expect(items).toEqual([
      { type: "text", text: "hello" },
      { type: "toolCall", name: "bash", args: { command: "ls" } },
      { type: "text", text: "world" },
    ]);
  });

  it("returns empty array for empty messages", () => {
    expect(getDisplayItems([])).toEqual([]);
  });
});

describe("formatToolCall", () => {
  describe("plain mode (no fg argument)", () => {
    it.each([
      ["bash with command", "bash", { command: "npm test" }, "$ npm test"],
      ["bash truncated at 60", "bash", { command: "a".repeat(80) }, `$ ${"a".repeat(60)}...`],
      ["bash without command", "bash", {}, "$ ..."],
      ["read with path", "read", { path: "src/index.ts" }, "read src/index.ts"],
      ["read with file_path", "read", { file_path: "f.ts" }, "read f.ts"],
      ["write with path", "write", { path: "out.ts" }, "write out.ts"],
      ["edit with path", "edit", { path: "e.ts" }, "edit e.ts"],
      ["grep", "grep", { pattern: "TODO" }, "grep /TODO/"],
      ["find", "find", { pattern: "*.ts" }, "find *.ts"],
      ["unknown tool", "custom-tool", {}, "custom-tool"],
    ])("%s", (_label, name, args, expected) => {
      expect(formatToolCall(name, args)).toBe(expected);
    });
  });

  describe("coloured mode (with fg callback)", () => {
    const fg = (c: string, t: string) => `[${c}]${t}`;

    it.each([
      ["bash with command", "bash", { command: "ls -la" }, "[muted]$ [toolOutput]ls -la"],
      ["bash truncated at 60", "bash", { command: "a".repeat(80) }, `[muted]$ [toolOutput]${"a".repeat(60)}...`],
      ["bash without command", "bash", {}, "[muted]$ [toolOutput]..."],
      ["read with path", "read", { path: "src/index.ts" }, "[muted]read [accent]src/index.ts"],
      ["read with file_path", "read", { file_path: "f.ts" }, "[muted]read [accent]f.ts"],
      ["write with path", "write", { path: "out.ts" }, "[muted]write [accent]out.ts"],
      ["edit with path", "edit", { path: "e.ts" }, "[muted]edit [accent]e.ts"],
      ["grep", "grep", { pattern: "TODO" }, "[muted]grep [accent]/TODO/"],
      ["find", "find", { pattern: "*.ts" }, "[muted]find [accent]*.ts"],
      ["unknown tool", "unknown-tool", {}, "[accent]unknown-tool"],
    ])("%s", (_label, name, args, expected) => {
      expect(formatToolCall(name, args, fg)).toBe(expected);
    });
  });
});

describe("formatUsage", () => {
  it("formats tokens with k-suffix above 1000, includes turns/cost/model", () => {
    expect(formatUsage({ input: 500, output: 200, cost: 0.0123, turns: 5 }, "gpt-4")).toBe(
      "5t ↑500 ↓200 $0.0123 gpt-4",
    );
    expect(formatUsage({ input: 1500, output: 25000, cost: 0, turns: 0 })).toBe("↑2k ↓25k");
  });

  it("returns empty string when all zeros", () => {
    expect(formatUsage({ input: 0, output: 0, cost: 0, turns: 0 })).toBe("");
  });
});
