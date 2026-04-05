import { describe, expect, it } from "vitest";
import { applyMessageToStage, extractFinalOutput, parseMessageLine } from "./message-parser.js";
import { makeAssistantMessage, makeStage } from "./test-utils.js";

describe("parseMessageLine", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["tab and newline", "\t\n"],
  ])("returns null for %s", (_label, input) => {
    expect(parseMessageLine(input)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseMessageLine("{not json")).toBeNull();
    expect(parseMessageLine("just a string")).toBeNull();
  });

  it("parses valid NDJSON into a structured event", () => {
    const msg = makeAssistantMessage();
    const line = JSON.stringify({ type: "message_end", message: msg });
    const result = parseMessageLine(line);
    expect(result).toEqual({ type: "message_end", message: msg });
  });
});

describe("applyMessageToStage", () => {
  it("accumulates usage stats from an assistant message_end event", () => {
    const stage = makeStage();
    const msg = makeAssistantMessage();
    const updated = applyMessageToStage({ type: "message_end", message: msg }, stage);

    expect(updated).toBe(true);
    expect(stage.messages).toHaveLength(1);
    expect(stage.usage.input).toBe(100);
    expect(stage.usage.output).toBe(50);
    expect(stage.usage.cacheRead).toBe(10);
    expect(stage.usage.cacheWrite).toBe(5);
    expect(stage.usage.cost).toBe(0.0033);
    expect(stage.usage.turns).toBe(1);
    expect(stage.model).toBe("claude-sonnet");
  });

  it("pushes tool_result_end messages and returns true", () => {
    const stage = makeStage();
    const msg = {
      role: "toolResult" as const,
      toolCallId: "tc-1",
      toolName: "bash",
      content: [{ type: "text" as const, text: "output" }],
      isError: false,
      timestamp: Date.now(),
    };
    const updated = applyMessageToStage({ type: "tool_result_end", message: msg }, stage);

    expect(updated).toBe(true);
    expect(stage.messages).toHaveLength(1);
    expect(stage.messages[0]).toBe(msg);
  });

  it("ignores unrecognised event types and returns false", () => {
    const stage = makeStage();
    const updated = applyMessageToStage({ type: "unknown_event" }, stage);

    expect(updated).toBe(false);
    expect(stage.messages).toHaveLength(0);
  });

  it("does not overwrite model once set", () => {
    const stage = makeStage();
    const msg1 = makeAssistantMessage({ model: "claude-sonnet" });
    const msg2 = makeAssistantMessage({ model: "claude-opus" });
    applyMessageToStage({ type: "message_end", message: msg1 }, stage);
    applyMessageToStage({ type: "message_end", message: msg2 }, stage);

    expect(stage.model).toBe("claude-sonnet");
  });
});

describe("extractFinalOutput", () => {
  it("finds the last assistant text block from messages", () => {
    const stage = makeStage({
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "ignored" }],
          timestamp: Date.now(),
        },
        makeAssistantMessage({ content: [{ type: "text" as const, text: "final answer" }] }),
      ],
    });
    extractFinalOutput(stage);
    expect(stage.output).toBe("final answer");
  });

  it("returns empty string when no assistant messages exist", () => {
    const stage = makeStage({ messages: [] });
    extractFinalOutput(stage);
    expect(stage.output).toBe("");
  });
});

describe("round-trip: parseMessageLine → applyMessageToStage → extractFinalOutput", () => {
  it("produces correct stage output from raw NDJSON lines", () => {
    const stage = makeStage();
    const msg = makeAssistantMessage({ content: [{ type: "text" as const, text: "The final result" }] });

    const lines = [
      JSON.stringify({ type: "message_start" }),
      JSON.stringify({ type: "message_end", message: msg }),
      "",
      "not json {",
    ];

    for (const line of lines) {
      const event = parseMessageLine(line);
      if (event) applyMessageToStage(event, stage);
    }

    extractFinalOutput(stage);

    expect(stage.messages).toHaveLength(1);
    expect(stage.output).toBe("The final result");
    expect(stage.usage.turns).toBe(1);
  });
});
