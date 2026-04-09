import { describe, expect, it } from "vitest";
import type { PipelineDetails } from "../pipeline.js";
import { makeStage, mockTheme } from "../test-utils.js";
import { previewLines, renderCollapsed, renderExpanded, stageIcon } from "./stage-renderer.js";

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
  it("in live state (any stage pending or running), emits only minimal per-stage lines with no pipeline header, no tool calls, no previews, and no expand hint", () => {
    const theme = mockTheme();
    const details: PipelineDetails = {
      pipeline: "architecture",
      stages: [
        makeStage({
          name: "architecture-reviewer",
          status: "running",
          messages: [
            {
              role: "assistant",
              content: [
                { type: "toolCall", name: "read", arguments: { path: "live-file-1.ts" } },
                { type: "toolCall", name: "read", arguments: { path: "live-file-2.ts" } },
                { type: "toolCall", name: "grep", arguments: { pattern: "LIVE-TODO" } },
              ],
            },
          ],
          output: "partial output should not leak",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.0001, turns: 1 },
        }),
        makeStage({ name: "next-stage", status: "pending" }),
      ],
    };

    const joined = renderCollapsed(details, theme, "forgeflow-dev").render(200).join("\n");

    // Running stage: icon + name on one line.
    expect(joined).toContain("[warning]⟳ [toolTitle]architecture-reviewer");
    // Pending stage: muted icon + name on one line.
    expect(joined).toContain("[muted]○ [toolTitle]next-stage");

    // No pipeline header — it is already shown by renderCall.
    expect(joined).not.toContain("forgeflow-dev");
    expect(joined).not.toContain("[accent]architecture");

    // No tool-call list — live detail lives in the widget.
    expect(joined).not.toContain("→");
    expect(joined).not.toContain("live-file-1.ts");
    expect(joined).not.toContain("live-file-2.ts");
    expect(joined).not.toContain("LIVE-TODO");

    // No previews or usage leaking through while still live.
    expect(joined).not.toContain("partial output should not leak");
    expect(joined).not.toContain("1t");

    // No expand hint while still running.
    expect(joined).not.toContain("to expand");
  });

  it("after the pipeline completes, shows the full header, per-stage usage, 3-line preview, error-coloured failures, and a single expand hint", () => {
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
      ],
    };

    const textNode = renderCollapsed(details, theme, "forgeflow-dev");
    const lines = textNode.render(200);
    const joined = lines.join("\n");

    // Header present once the pipeline is complete.
    expect(joined).toContain("forgeflow-dev");
    expect(joined).toContain("[accent]implement");

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
