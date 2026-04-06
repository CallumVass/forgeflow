import { describe, expect, it } from "vitest";
import { applyMessageToStage, extractFinalOutput, parseMessageLine } from "./message-parser.js";
import { makeAssistantMessage, makeStage } from "./test-utils.js";

describe("parseMessageLine", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["malformed JSON", "{not json"],
  ])("returns null for %s", (_label, input) => {
    expect(parseMessageLine(input)).toBeNull();
  });

  it("parses valid NDJSON into a structured event", () => {
    const msg = makeAssistantMessage();
    const line = JSON.stringify({ type: "message_end", message: msg });
    expect(parseMessageLine(line)).toEqual({ type: "message_end", message: msg });
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
    expect(stage.usage.cost).toBe(0.0033);
    expect(stage.usage.turns).toBe(1);
    expect(stage.model).toBe("claude-sonnet");
  });

  it("ignores unrecognised event types and returns false", () => {
    const stage = makeStage();
    expect(applyMessageToStage({ type: "unknown_event" }, stage)).toBe(false);
    expect(stage.messages).toHaveLength(0);
  });
});

describe("extractFinalOutput", () => {
  it("finds the last assistant text block from messages", () => {
    const stage = makeStage({
      messages: [
        { role: "user" as const, content: [{ type: "text" as const, text: "ignored" }], timestamp: Date.now() },
        makeAssistantMessage({ content: [{ type: "text" as const, text: "final answer" }] }),
      ],
    });
    extractFinalOutput(stage);
    expect(stage.output).toBe("final answer");
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
    expect(stage.output).toBe("The final result");
    expect(stage.usage.turns).toBe(1);
  });
});
