import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("testing public entry point", () => {
  it("exposes the helper surface used by consumer tests", () => {
    const valueExports = [
      "firstCustomCapture",
      "getRegisteredCommandHandler",
      "makeCustomUiMock",
      "mockExecFn",
      "mockForgeflowContext",
      "mockPi",
      "mockPipelineContext",
      "mockRunAgent",
      "sequencedRunAgent",
      "setupIsolatedHomeFixture",
    ];
    for (const name of valueExports) {
      expect(barrel).toHaveProperty(name);
    }
  });
});
