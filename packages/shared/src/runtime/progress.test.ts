import { describe, expect, it, vi } from "vitest";
import { makeAssistantMessage, makeStage } from "../testing/index.js";
import { emitUpdate, getLastToolCall, pipelineResult } from "./progress.js";

describe("pipelineResult", () => {
  it("returns correct shape and omits isError when falsy", () => {
    const stages = [makeStage({ name: "planner" })];
    const result = pipelineResult("Done.", "implement", stages);
    expect(result).toEqual({
      content: [{ type: "text", text: "Done." }],
      details: { pipeline: "implement", stages },
    });
    expect(result).not.toHaveProperty("isError");

    const err = pipelineResult("Fail.", "review", stages, true);
    expect(err.isError).toBe(true);
  });
});

describe("getLastToolCall", () => {
  it.each([
    ["bash with command", [{ type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }], "$ ls"],
    ["bash without command", [{ type: "toolCall", id: "t", name: "bash", arguments: {} }], "$ ..."],
    ["no tool calls", [{ type: "text", text: "just text" }], ""],
  ])("%s", (_label, content, expected) => {
    const messages = content.length ? [makeAssistantMessage({ content })] : [];
    expect(getLastToolCall(content.length ? messages : [])).toBe(expected);
  });

  it("returns empty string for empty messages", () => {
    expect(getLastToolCall([])).toBe("");
  });
});

describe("emitUpdate", () => {
  it("calls onUpdate with running stage tool info or status messages", () => {
    const onUpdate = vi.fn();

    emitUpdate({
      stages: [
        makeStage({
          name: "planner",
          status: "running",
          messages: [
            makeAssistantMessage({
              content: [{ type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }],
            }),
          ],
        }),
      ],
      pipeline: "implement",
      onUpdate,
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: "text", text: "[planner] $ ls" }] }),
    );

    onUpdate.mockClear();
    emitUpdate({
      stages: [makeStage({ status: "done" }), makeStage({ status: "done" })],
      pipeline: "test",
      onUpdate,
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: "text", text: "Pipeline complete" }] }),
    );
  });

  it("is a no-op when onUpdate is undefined", () => {
    expect(() => emitUpdate({ stages: [], pipeline: "test" })).not.toThrow();
  });
});
