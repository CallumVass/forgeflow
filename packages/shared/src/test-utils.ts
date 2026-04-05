import { type Mock, vi } from "vitest";
import { emptyStage, type ForgeflowContext, type ForgeflowUI, type RunAgentFn, type StageResult } from "./types.js";

/** Create a mock RunAgentFn that returns a StageResult with configurable output and status. */
export function mockRunAgent(output = "", status: StageResult["status"] = "done"): Mock<RunAgentFn> {
  return vi.fn(async () => ({
    ...emptyStage("mock"),
    output,
    status,
  }));
}

/** Create a minimal ForgeflowContext for testing. All UI methods are no-op stubs. */
export function mockForgeflowContext(overrides?: {
  hasUI?: boolean;
  cwd?: string;
  ui?: Partial<ForgeflowUI>;
}): ForgeflowContext {
  return {
    hasUI: overrides?.hasUI ?? false,
    cwd: overrides?.cwd ?? "/tmp/test",
    ui: {
      input: async () => undefined,
      editor: async () => undefined,
      select: async () => undefined,
      setStatus: () => {},
      setWidget: () => {},
      ...overrides?.ui,
    },
  };
}
