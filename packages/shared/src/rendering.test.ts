import { describe, expect, it } from "vitest";
import {
  formatToolCall,
  formatToolCallShort,
  formatUsage,
  getDisplayItems,
  renderCollapsed,
  renderExpanded,
  stageIcon,
} from "./rendering.js";
import type { PipelineDetails } from "./stage.js";
import { makeStage, mockTheme } from "./test-utils.js";

describe("rendering exports", () => {
  it("exports all eight symbols", () => {
    // DisplayItem is a type-only export, verified by the import above compiling.
    // The seven functions must be real functions.
    expect(typeof getDisplayItems).toBe("function");
    expect(typeof formatToolCall).toBe("function");
    expect(typeof formatToolCallShort).toBe("function");
    expect(typeof formatUsage).toBe("function");
    expect(typeof stageIcon).toBe("function");
    expect(typeof renderExpanded).toBe("function");
    expect(typeof renderCollapsed).toBe("function");
  });
});

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

describe("formatToolCallShort (deprecated alias)", () => {
  it("delegates to formatToolCall", () => {
    const fg = (c: string, t: string) => `[${c}]${t}`;
    expect(formatToolCallShort("bash", { command: "ls" }, fg)).toBe(formatToolCall("bash", { command: "ls" }, fg));
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

describe("stageIcon", () => {
  it("returns correct themed icon for each status", () => {
    const theme = mockTheme();
    expect(stageIcon(makeStage({ status: "done" }), theme)).toBe("[success]✓");
    expect(stageIcon(makeStage({ status: "running" }), theme)).toBe("[warning]⟳");
    expect(stageIcon(makeStage({ status: "failed" }), theme)).toBe("[error]✗");
    expect(stageIcon(makeStage({ status: "pending" }), theme)).toBe("[muted]○");
  });
});

describe("renderExpanded", () => {
  it("returns a Container with header, stage sections, tool calls, and usage", () => {
    const theme = mockTheme();
    const details: PipelineDetails = {
      pipeline: "implement",
      stages: [
        makeStage({
          name: "planner",
          status: "done",
          messages: [
            {
              role: "assistant",
              content: [
                { type: "toolCall", name: "bash", arguments: { command: "ls" } },
                { type: "text", text: "Plan complete" },
              ],
            },
          ],
          usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 3 },
          model: "claude",
          output: "Plan complete",
        }),
      ],
    };

    const container = renderExpanded(details, theme, "forgeflow-dev");
    // Container should have children: header, spacer, stage title, tool call line, spacer, output text, usage, spacer
    expect(container.children.length).toBeGreaterThanOrEqual(5);

    // Render to verify content
    const lines = container.render(120);
    const joined = lines.join("\n");
    expect(joined).toContain("forgeflow-dev");
    expect(joined).toContain("implement");
    expect(joined).toContain("planner");
    expect(joined).toContain("ls");
    expect(joined).toContain("3t");
  });
});

describe("renderCollapsed", () => {
  it("returns a Text with header, stage status, tool calls for running, preview for done", () => {
    const theme = mockTheme();
    const details: PipelineDetails = {
      pipeline: "review",
      stages: [
        makeStage({
          name: "checker",
          status: "done",
          output: "All checks passed",
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1 },
        }),
        makeStage({
          name: "reviewer",
          status: "running",
          messages: [
            {
              role: "assistant",
              content: [
                { type: "toolCall", name: "read", arguments: { path: "a.ts" } },
                { type: "toolCall", name: "read", arguments: { path: "b.ts" } },
                { type: "toolCall", name: "grep", arguments: { pattern: "TODO" } },
                { type: "toolCall", name: "bash", arguments: { command: "npm test" } },
              ],
            },
          ],
        }),
        makeStage({ name: "judge", status: "pending" }),
      ],
    };

    const textNode = renderCollapsed(details, theme, "forgeflow-pm");
    const lines = textNode.render(120);
    const joined = lines.join("\n");

    // Header
    expect(joined).toContain("forgeflow-pm");
    expect(joined).toContain("review");

    // Done stage shows preview
    expect(joined).toContain("All checks passed");
    expect(joined).toContain("1t");

    // Running stage shows last 3 tool calls (b.ts, TODO, npm test — not a.ts)
    expect(joined).not.toContain("a.ts");
    expect(joined).toContain("b.ts");
    expect(joined).toContain("TODO");
    expect(joined).toContain("npm test");

    // Pending stage shown
    expect(joined).toContain("judge");
  });
});

