import { describe, expect, it } from "vitest";
import { parseAgentLambdaResolution } from "./explorer.js";

describe("parseAgentLambdaResolution", () => {
  it("parses plain JSON output", () => {
    const result = parseAgentLambdaResolution(
      JSON.stringify({
        selected: {
          file: ".infra/lib/infra-stack.ts",
          line: 42,
          className: "IVCEFunction",
          functionName: "clients-me-prod",
        },
        candidates: [],
        ambiguous: false,
      }),
    );

    if (typeof result === "string") throw new Error(result);
    expect(result.selected?.functionName).toBe("clients-me-prod");
    expect(result.ambiguous).toBe(false);
  });

  it("parses fenced JSON output", () => {
    const result = parseAgentLambdaResolution(
      [
        "Here is the result:",
        "```json",
        '{"selected":null,"candidates":[{"file":"infra/stack.ts","line":7,"constructId":"ClientsMeLambda"}],"ambiguous":true}',
        "```",
      ].join("\n"),
    );

    if (typeof result === "string") throw new Error(result);
    expect(result.selected).toBeUndefined();
    expect(result.candidates[0]?.constructId).toBe("ClientsMeLambda");
    expect(result.ambiguous).toBe(true);
  });

  it("returns an error for invalid payloads", () => {
    expect(parseAgentLambdaResolution("not json")).toContain("no JSON payload");
  });
});
