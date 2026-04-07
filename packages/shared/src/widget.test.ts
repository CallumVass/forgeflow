import { describe, expect, it } from "vitest";
import { makeAssistantMessage, makeStage, mockTheme } from "./test-utils.js";
import { buildWidgetLines } from "./widget.js";

// ─── buildWidgetLines (validation group) ──────────────────────────────

describe("buildWidgetLines", () => {
  it("header line includes the pipeline name and n/total stages count", () => {
    const stages = [
      makeStage({ name: "planner", status: "done" }),
      makeStage({ name: "implementor", status: "done" }),
      makeStage({ name: "refactorer", status: "running" }),
      makeStage({ name: "reviewer", status: "pending" }),
    ];
    const lines = buildWidgetLines("forgeflow-dev implement", stages, mockTheme());
    expect(lines[0]).toContain("forgeflow-dev implement");
    expect(lines[0]).toContain("2/4");
  });

  it("running stage with ≥4 tool calls returns the last 3 formatted via formatToolCall", () => {
    const stage = makeStage({
      name: "implementor",
      status: "running",
      messages: [
        makeAssistantMessage({
          content: [
            { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
            { type: "toolCall", id: "t2", name: "read", arguments: { path: "a.ts" } },
            { type: "toolCall", id: "t3", name: "edit", arguments: { path: "b.ts" } },
            { type: "toolCall", id: "t4", name: "write", arguments: { path: "c.ts" } },
          ],
        }),
      ],
    });
    const lines = buildWidgetLines("implement", [stage], mockTheme());
    const body = lines.join("\n");

    // Last 3 should appear; first should not.
    expect(body).not.toContain("ls");
    expect(body).toContain("a.ts");
    expect(body).toContain("b.ts");
    expect(body).toContain("c.ts");
    // Stage name shows.
    expect(body).toContain("implementor");
  });

  it("running stage with no tool calls yet includes a (starting…) placeholder", () => {
    const stage = makeStage({ name: "planner", status: "running", messages: [] });
    const lines = buildWidgetLines("implement", [stage], mockTheme());
    const body = lines.join("\n");
    expect(body).toContain("planner");
    expect(body).toContain("starting…");
  });

  it("stages all done returns a complete line", () => {
    const stages = [makeStage({ status: "done" }), makeStage({ status: "done" })];
    const lines = buildWidgetLines("implement", stages, mockTheme());
    const body = lines.join("\n").toLowerCase();
    expect(body).toContain("complete");
  });
});
