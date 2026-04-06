import { describe, expect, it } from "vitest";
import * as barrel from "./pipeline.js";

describe("pipeline barrel re-exports", () => {
  it("exposes all 17 value exports", () => {
    const valueExports = [
      "TOOLS_ALL", "TOOLS_READONLY", "TOOLS_NO_EDIT",
      "SIGNALS", "signalPath", "signalExists", "readSignal", "cleanSignal",
      "resolveAgentsDir", "emptyUsage", "emptyStage", "pipelineResult", "sumUsage",
      "getLastToolCall", "emitUpdate",
      "toPipelineContext", "toAgentOpts",
    ];
    for (const name of valueExports) {
      expect(barrel).toHaveProperty(name);
    }
  });
});
