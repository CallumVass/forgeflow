import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("runtime public entry point", () => {
  it("exposes the current runtime value exports", () => {
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
    expect(barrel).toHaveProperty("withRunLifecycle");
  });
});
