import { describe, expect, it } from "vitest";
import * as barrel from "./pipeline.js";

describe("pipeline barrel re-exports", () => {
  it("exposes all 14 value exports", () => {
    const valueExports = [
      "SIGNALS",
      "signalPath",
      "signalExists",
      "readSignal",
      "cleanSignal",
      "resolveAgentsDir",
      "emptyUsage",
      "emptyStage",
      "pipelineResult",
      "sumUsage",
      "getLastToolCall",
      "emitUpdate",
      "toPipelineContext",
      "toAgentOpts",
    ];
    for (const name of valueExports) {
      expect(barrel).toHaveProperty(name);
    }
  });
});
