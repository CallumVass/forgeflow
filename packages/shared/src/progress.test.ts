import { describe, expect, it, vi } from "vitest";
import { emitUpdate, getLastToolCall } from "./progress.js";
import { makeAssistantMessage, makeStage } from "./test-utils.js";

describe("getLastToolCall", () => {
  it("delegates to formatToolCall for plain output", () => {
    const messages = [
      makeAssistantMessage({ content: [{ type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "ls" } }] }),
    ];
    expect(getLastToolCall(messages)).toBe("$ ls");
  });

  it("returns plain output for bash without command", () => {
    const messages = [
      makeAssistantMessage({ content: [{ type: "toolCall", id: "tc-1", name: "bash", arguments: {} }] }),
    ];
    expect(getLastToolCall(messages)).toBe("$ ...");
  });

  it("returns empty string for empty messages", () => {
    expect(getLastToolCall([])).toBe("");
  });

  it("returns empty string when messages have no tool calls", () => {
    const messages = [makeAssistantMessage({ content: [{ type: "text", text: "just text" }] })];
    expect(getLastToolCall(messages)).toBe("");
  });
});

describe("emitUpdate", () => {
  it("calls onUpdate with running stage and tool call", () => {
    const onUpdate = vi.fn();
    const stages = [
      makeStage({
        name: "planner",
        status: "running",
        messages: [
          makeAssistantMessage({
            content: [{ type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "ls" } }],
          }),
        ],
      }),
    ];
    emitUpdate({ stages, pipeline: "implement", onUpdate });

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "[planner] $ ls" }],
      details: { pipeline: "implement", stages },
    });
  });

  it("calls onUpdate with 'running...' when no tool calls", () => {
    const onUpdate = vi.fn();
    const stages = [makeStage({ name: "reviewer", status: "running" })];
    emitUpdate({ stages, pipeline: "review", onUpdate });

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "[reviewer] running..." }],
      details: { pipeline: "review", stages },
    });
  });

  it("shows 'Pipeline complete' when all stages are done", () => {
    const onUpdate = vi.fn();
    const stages = [makeStage({ name: "a", status: "done" }), makeStage({ name: "b", status: "done" })];
    emitUpdate({ stages, pipeline: "test", onUpdate });

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Pipeline complete" }],
      details: { pipeline: "test", stages },
    });
  });

  it("shows 'Processing...' for mixed non-running states", () => {
    const onUpdate = vi.fn();
    const stages = [makeStage({ name: "a", status: "done" }), makeStage({ name: "b", status: "pending" })];
    emitUpdate({ stages, pipeline: "test", onUpdate });

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Processing..." }],
      details: { pipeline: "test", stages },
    });
  });

  it("is a no-op when onUpdate is undefined", () => {
    // Should not throw
    expect(() => {
      emitUpdate({ stages: [], pipeline: "test" });
    }).not.toThrow();
  });
});
