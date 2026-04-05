import { type Mock, vi } from "vitest";
import {
  emptyStage,
  type ForgeflowContext,
  type ForgeflowTheme,
  type ForgeflowUI,
  type PipelineContext,
  type RunAgentFn,
  type StageResult,
} from "./types.js";

/** Create a mock theme that prefixes text with the category for test assertions. */
export function mockTheme(): ForgeflowTheme {
  return {
    fg: (category: string, text: string) => `[${category}]${text}`,
    bold: (text: string) => `**${text}**`,
  };
}

/** Create a mock RunAgentFn that returns a StageResult with configurable output and status. */
export function mockRunAgent(output = "", status: StageResult["status"] = "done"): Mock<RunAgentFn> {
  return vi.fn(async () => ({
    ...emptyStage("mock"),
    output,
    status,
  }));
}

/** Create a minimal PipelineContext for testing. */
export function mockPipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    cwd: "/tmp/test",
    signal: AbortSignal.timeout(5000),
    onUpdate: undefined,
    ctx: mockForgeflowContext(overrides?.ctx ? { hasUI: overrides.ctx.hasUI, cwd: overrides.ctx.cwd } : undefined),
    ...overrides,
  };
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
