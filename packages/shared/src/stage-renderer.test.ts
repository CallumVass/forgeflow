import { describe, expect, it } from "vitest";
import type { PipelineDetails } from "./pipeline.js";
import { renderCollapsed, renderExpanded, stageIcon } from "./stage-renderer.js";
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
});
