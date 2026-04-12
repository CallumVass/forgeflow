import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("testing public entry point", () => {
  it("exposes the helper surface used by consumer tests", () => {
    const valueExports = [
      "firstCustomCapture",
      "getRegisteredCommandHandler",
      "getRegisteredEventHandler",
      "getRegisteredToolDefinition",
      "makeCustomUiMock",
      "mockExecFn",
      "mockForgeflowContext",
      "mockPi",
      "mockPipelineAgentRuntime",
      "mockPipelineContext",
      "mockPipelineExecRuntime",
      "mockPipelineSessionLifecycleRuntime",
      "mockPipelineSessionRuntime",
      "mockPipelineSkillRuntime",
      "mockPipelineUiRuntime",
      "mockRunAgent",
      "sequencedRunAgent",
      "setupIsolatedHomeFixture",
    ];
    for (const name of valueExports) {
      expect(barrel).toHaveProperty(name);
    }
  });
});
