import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { emitUpdate, emptyStage, getLastToolCall, pipelineResult, resolveAgentsDir, sumUsage } from "./stages.js";
import { makeAssistantMessage, makeStage } from "./test-utils.js";

describe("emptyStage", () => {
  it("returns a pending stage with empty defaults", () => {
    const stage = emptyStage("planner");
    expect(stage).toEqual({
      name: "planner",
      status: "pending",
      messages: [],
      exitCode: -1,
      stderr: "",
      output: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    });
  });
});

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

describe("sumUsage", () => {
  it("aggregates usage across stages", () => {
    const stages = [
      makeStage({ usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: 0.01, turns: 2 } }),
      makeStage({ usage: { input: 200, output: 100, cacheRead: 20, cacheWrite: 10, cost: 0.02, turns: 3 } }),
    ];
    expect(sumUsage(stages)).toEqual({
      input: 300,
      output: 150,
      cacheRead: 30,
      cacheWrite: 15,
      cost: 0.03,
      turns: 5,
    });
  });
});

describe("resolveAgentsDir", () => {
  it("resolves relative to the directory of the URL", () => {
    const url1 = pathToFileURL("/packages/dev/dist/index.js").href;
    const url2 = pathToFileURL("/packages/pm/dist/index.js").href;

    expect(resolveAgentsDir(url1)).toBe(path.resolve("/packages/dev", "agents"));
    expect(resolveAgentsDir(url2)).toBe(path.resolve("/packages/pm", "agents"));
    expect(resolveAgentsDir(url1)).not.toBe(resolveAgentsDir(url2));
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
