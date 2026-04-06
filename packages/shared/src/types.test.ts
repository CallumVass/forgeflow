import { describe, expect, it } from "vitest";
import { makeStage } from "./test-utils.js";
import { pipelineResult } from "./types.js";

describe("pipelineResult", () => {
  it("returns correct shape for success case", () => {
    const stages = [makeStage({ name: "planner" }), makeStage({ name: "implementor" })];

    const result = pipelineResult("Implementation complete.", "implement", stages);

    expect(result).toEqual({
      content: [{ type: "text", text: "Implementation complete." }],
      details: { pipeline: "implement", stages },
    });
    expect(result).not.toHaveProperty("isError");
  });

  it("includes isError when true, omits when false", () => {
    const stages = [makeStage({ name: "reviewer" })];

    const errorResult = pipelineResult("Failed.", "review", stages, true);
    expect(errorResult.isError).toBe(true);

    const falseResult = pipelineResult("OK.", "review", stages, false);
    expect(falseResult).not.toHaveProperty("isError");
  });
});
