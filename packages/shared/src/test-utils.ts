import { type Mock, vi } from "vitest";
import type { ForgeflowContext, ForgeflowTheme, ForgeflowUI, PipelineContext } from "./pipeline.js";
import { emptyStage, type RunAgentFn, type StageResult } from "./pipeline.js";

/** Create a StageResult with defaults, overridable for tests. */
export function makeStage(overrides: Partial<StageResult> = {}): StageResult {
  return { ...emptyStage("test-stage"), ...overrides };
}

/** Create a realistic assistant message with defaults, overridable for tests. */
export function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "hello" }],
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    model: "claude-sonnet",
    usage: {
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 165,
      cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0033 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
    ...overrides,
  };
}

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

/** Create a mock RunAgentFn that returns responses in sequence, one per call. */
export function sequencedRunAgent(responses: Array<{ output: string; status?: StageResult["status"] }>): RunAgentFn {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex] ?? { output: "", status: "done" as const };
    callIndex++;
    return { ...emptyStage("mock"), output: response.output, status: response.status ?? ("done" as const) };
  }) as unknown as RunAgentFn;
}

/** Create a minimal PipelineContext for testing. */
export function mockPipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    cwd: "/tmp/test",
    signal: AbortSignal.timeout(5000),
    onUpdate: undefined,
    ctx: mockForgeflowContext(overrides?.ctx ? { hasUI: overrides.ctx.hasUI, cwd: overrides.ctx.cwd } : undefined),
    agentsDir: "/tmp/agents",
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
