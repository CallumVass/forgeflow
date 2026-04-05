import { describe, expect, it, vi } from "vitest";
import { emitUpdate, getLastToolCall } from "./progress.js";
import type { StageResult } from "./types.js";
import { emptyStage } from "./types.js";

function makeStage(overrides: Partial<StageResult> = {}): StageResult {
  return { ...emptyStage("test-stage"), ...overrides };
}

function makeAssistantMessage(content: unknown[]) {
  return {
    role: "assistant" as const,
    content,
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    model: "claude-sonnet",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

describe("getLastToolCall", () => {
  it.each([
    ["bash with command", "bash", { command: "npm test" }, "$ npm test"],
    ["bash truncated at 60", "bash", { command: "a".repeat(80) }, `$ ${"a".repeat(60)}`],
    ["bash without command", "bash", {}, "bash"],
    ["read with path", "read", { path: "src/index.ts" }, "read src/index.ts"],
    ["read with file_path", "read", { file_path: "f.ts" }, "read f.ts"],
    ["write with path", "write", { path: "out.ts" }, "write out.ts"],
    ["edit with path", "edit", { path: "e.ts" }, "edit e.ts"],
    ["grep", "grep", { pattern: "TODO" }, "grep /TODO/"],
    ["find", "find", { pattern: "*.ts" }, "find *.ts"],
    ["unknown tool", "custom-tool", {}, "custom-tool"],
  ])("formats %s correctly", (_label, name, args, expected) => {
    const messages = [makeAssistantMessage([{ type: "toolCall", id: "tc-1", name, arguments: args }])];
    expect(getLastToolCall(messages)).toBe(expected);
  });

  it("returns empty string for empty messages", () => {
    expect(getLastToolCall([])).toBe("");
  });

  it("returns empty string when messages have no tool calls", () => {
    const messages = [makeAssistantMessage([{ type: "text", text: "just text" }])];
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
          makeAssistantMessage([{ type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "ls" } }]),
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
