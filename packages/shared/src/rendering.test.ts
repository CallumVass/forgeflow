import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatToolCallShort,
  formatUsage,
  getDisplayItems,
  renderCollapsed,
  renderExpanded,
  stageIcon,
} from "./rendering.js";
import type { ForgeflowContext, ForgeflowTheme, ForgeflowUI, PipelineDetails, StageResult } from "./types.js";
import { emptyStage } from "./types.js";

// Helper: mock theme that passes through text with category prefix for assertions
function mockTheme() {
  return {
    fg: (category: string, text: string) => `[${category}]${text}`,
    bold: (text: string) => `**${text}**`,
  };
}

function makeStage(overrides: Partial<StageResult> = {}): StageResult {
  return { ...emptyStage("test-stage"), ...overrides };
}

describe("rendering exports", () => {
  it("exports all seven symbols", () => {
    // DisplayItem is a type-only export, verified by the import above compiling.
    // The six functions must be real functions.
    expect(typeof getDisplayItems).toBe("function");
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

describe("formatToolCallShort", () => {
  const fg = (c: string, t: string) => `[${c}]${t}`;

  it("formats each tool type correctly", () => {
    // bash: normal, truncated at 60, missing command
    expect(formatToolCallShort("bash", { command: "ls -la" }, fg)).toBe("[muted]$ [toolOutput]ls -la");
    expect(formatToolCallShort("bash", { command: "a".repeat(80) }, fg)).toBe(
      `[muted]$ [toolOutput]${"a".repeat(60)}...`,
    );
    expect(formatToolCallShort("bash", {}, fg)).toBe("[muted]$ [toolOutput]...");

    // file tools: path and file_path fallback
    expect(formatToolCallShort("read", { path: "src/index.ts" }, fg)).toBe("[muted]read [accent]src/index.ts");
    expect(formatToolCallShort("read", { file_path: "f.ts" }, fg)).toBe("[muted]read [accent]f.ts");
    expect(formatToolCallShort("write", { path: "out.ts" }, fg)).toBe("[muted]write [accent]out.ts");
    expect(formatToolCallShort("edit", { path: "e.ts" }, fg)).toBe("[muted]edit [accent]e.ts");

    // search tools
    expect(formatToolCallShort("grep", { pattern: "TODO" }, fg)).toBe("[muted]grep [accent]/TODO/");
    expect(formatToolCallShort("find", { pattern: "*.ts" }, fg)).toBe("[muted]find [accent]*.ts");

    // unknown
    expect(formatToolCallShort("unknown-tool", {}, fg)).toBe("[accent]unknown-tool");
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

describe("extraction verification", () => {
  it("dev/index.ts and pm/index.ts have zero local definitions of the shared functions", () => {
    const symbols = [
      "function getDisplayItems",
      "function formatToolCallShort",
      "function formatUsage",
      "function renderExpanded",
      "function renderCollapsed",
      "function stageIcon",
    ];

    const devPath = resolve(__dirname, "../../dev/src/index.ts");
    const pmPath = resolve(__dirname, "../../pm/src/index.ts");
    const devSrc = readFileSync(devPath, "utf-8");
    const pmSrc = readFileSync(pmPath, "utf-8");

    for (const sym of symbols) {
      expect(devSrc).not.toContain(sym);
      expect(pmSrc).not.toContain(sym);
    }
  });

  it("dev/index.ts and pm/index.ts use createForgeflowExtension from shared (which handles renderResult internally)", () => {
    const devPath = resolve(__dirname, "../../dev/src/index.ts");
    const pmPath = resolve(__dirname, "../../pm/src/index.ts");
    const devSrc = readFileSync(devPath, "utf-8");
    const pmSrc = readFileSync(pmPath, "utf-8");

    for (const src of [devSrc, pmSrc]) {
      expect(src).toContain("@callumvass/forgeflow-shared");
      expect(src).toContain("createForgeflowExtension");
    }

    // renderResult is now called internally by the factory in extension.ts
    const extensionSrc = readFileSync(resolve(__dirname, "extension.ts"), "utf-8");
    expect(extensionSrc).toContain("renderResult");
  });
});

describe("type safety: AnyCtx removal", () => {
  it("zero AnyCtx references remain in non-test source files", () => {
    const srcDirs = [resolve(__dirname, "."), resolve(__dirname, "../../dev/src"), resolve(__dirname, "../../pm/src")];
    const { readdirSync } = require("node:fs");
    const { join } = require("node:path");

    function walk(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walk(full));
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts"))
          results.push(full);
      }
      return results;
    }

    const violations: string[] = [];
    for (const dir of srcDirs) {
      for (const file of walk(dir)) {
        const content = readFileSync(file, "utf-8");
        if (content.includes("AnyCtx")) violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("ForgeflowContext, ForgeflowUI, OnUpdate, and ForgeflowTheme are exported from shared types", () => {
    // These imports would fail at compile time if the types don't exist.
    // At runtime, verify they're usable as type constraints by creating conforming objects.
    const ui: ForgeflowUI = {
      input: async () => undefined,
      editor: async () => undefined,
      select: async () => undefined,
      setStatus: () => {},
      setWidget: () => {},
    };
    const ctx: ForgeflowContext = { hasUI: true, cwd: "/tmp", ui };
    expect(ctx.hasUI).toBe(true);
    expect(ctx.cwd).toBe("/tmp");
    expect(typeof ctx.ui.input).toBe("function");

    // ForgeflowTheme structural check
    const theme: ForgeflowTheme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    expect(typeof theme.fg).toBe("function");
    expect(typeof theme.bold).toBe("function");
  });
});
