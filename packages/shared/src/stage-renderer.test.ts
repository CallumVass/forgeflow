import { describe, expect, it } from "vitest";
import type { PipelineDetails } from "./pipeline.js";
import { previewLines, renderCollapsed, renderExpanded, stageIcon } from "./stage-renderer.js";
import { makeStage, mockTheme } from "./test-utils.js";

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

  it("shows multi-line preview for done stages, error-coloured preview for failed, last 3 tool calls for running, and a single expand hint", () => {
    const theme = mockTheme();
    const details: PipelineDetails = {
      pipeline: "implement",
      stages: [
        makeStage({
          name: "planner",
          status: "done",
          // Leading blank line and indentation should be stripped; only first 3 non-blank lines kept.
          output: "\n   first preview line\n  second preview line\nthird preview line\nfourth preview line",
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 2 },
        }),
        makeStage({
          name: "checker",
          status: "failed",
          output: "failure first line\nfailure second line",
          usage: { input: 50, output: 25, cacheRead: 0, cacheWrite: 0, cost: 0.0005, turns: 1 },
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
      ],
    };

    const textNode = renderCollapsed(details, theme, "forgeflow-dev");
    const lines = textNode.render(200);
    const joined = lines.join("\n");

    // Done stage shows first 3 non-blank lines, leading whitespace stripped, and drops the 4th line.
    expect(joined).toContain("first preview line");
    expect(joined).toContain("second preview line");
    expect(joined).toContain("third preview line");
    expect(joined).not.toContain("fourth preview line");
    expect(joined).not.toContain("   first preview line");

    // Usage stats stay on the same rendered line as the planner stage header (no newline between them).
    const headerWithUsage = lines.find((line) => line.includes("planner") && line.includes("2t"));
    expect(headerWithUsage).toBeDefined();

    // Failed stage's first preview line is wrapped in the error colour.
    expect(joined).toContain("[error]failure first line");
    // Subsequent failed lines are still shown.
    expect(joined).toContain("failure second line");

    // Running stage shows last 3 tool calls only.
    expect(joined).not.toContain("a.ts");
    expect(joined).toContain("b.ts");
    expect(joined).toContain("TODO");
    expect(joined).toContain("npm test");

    // Expand hint appears exactly once at the end.
    expect(joined).toContain("to expand");
    const matches = joined.match(/to expand/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("shows '(no output)' in muted colour for done stages with empty or whitespace-only output", () => {
    const theme = mockTheme();
    const empty: PipelineDetails = {
      pipeline: "implement",
      stages: [makeStage({ name: "planner", status: "done", output: "" })],
    };
    const emptyJoined = renderCollapsed(empty, theme, "forgeflow-dev").render(200).join("\n");
    expect(emptyJoined).toContain("[muted](no output)");

    const blank: PipelineDetails = {
      pipeline: "implement",
      stages: [makeStage({ name: "planner", status: "done", output: "   \n\n  \n" })],
    };
    const blankJoined = renderCollapsed(blank, theme, "forgeflow-dev").render(200).join("\n");
    expect(blankJoined).toContain("[muted](no output)");
  });
});

describe("previewLines", () => {
  it("strips leading blank lines and whitespace, caps at max, and handles empty/whitespace input", () => {
    // Strips leading blank lines and per-line leading whitespace.
    expect(previewLines("\n\n   first\n  second\nthird", 5)).toEqual(["first", "second", "third"]);

    // Caps at max entries (counts only non-blank lines).
    expect(previewLines("a\nb\nc\nd\ne", 3)).toEqual(["a", "b", "c"]);

    // Empty input returns [].
    expect(previewLines("", 3)).toEqual([]);

    // Whitespace-only input returns [].
    expect(previewLines("   \n\n\t\n", 3)).toEqual([]);

    // Internal blank lines are skipped (only non-blank lines counted toward cap).
    expect(previewLines("first\n\nsecond\n\nthird", 2)).toEqual(["first", "second"]);
  });
});
