import { type Mock, vi } from "vitest";
import type { ExecFn } from "./exec.js";
import type { ExtensionConfig } from "./extension-types.js";
import type { ForgeflowContext, ForgeflowTheme, ForgeflowUI, PipelineContext } from "./pipeline.js";
import { emptyStage, type PipelineDetails, type RunAgentFn, type StageResult } from "./pipeline.js";

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
export function sequencedRunAgent(
  responses: Array<{ output: string; status?: StageResult["status"] }>,
): Mock<RunAgentFn> {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex] ?? { output: "", status: "done" as const };
    callIndex++;
    return { ...emptyStage("mock"), output: response.output, status: response.status ?? ("done" as const) };
  });
}

/**
 * Create a mock ExecFn that returns scripted responses based on substring matches.
 * Falls through to an empty string when no pattern matches. Use for both `execFn`
 * (throwing variant) and `execSafeFn` (silent variant) at test boundaries.
 */
export function mockExecFn(responses: Record<string, string> = {}): Mock<ExecFn> {
  return vi.fn(async (cmd: string, _cwd?: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    return "";
  });
}

/**
 * Create a minimal PipelineContext for testing. Defaults `runAgentFn`, `execFn`,
 * and `execSafeFn` to fresh `vi.fn()` spies so tests never spawn real sub-processes
 * or shell commands. Override any field by passing it in the overrides object.
 */
export function mockPipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    cwd: "/tmp/test",
    signal: AbortSignal.timeout(5000),
    onUpdate: undefined,
    ctx: mockForgeflowContext(overrides?.ctx ? { hasUI: overrides.ctx.hasUI, cwd: overrides.ctx.cwd } : undefined),
    agentsDir: "/tmp/agents",
    runAgentFn: mockRunAgent(),
    execFn: vi.fn(async () => "") as Mock<ExecFn>,
    execSafeFn: vi.fn(async () => "") as Mock<ExecFn>,
    ...overrides,
  };
}

/** Create a minimal mock of pi's ExtensionAPI surface used by `createForgeflowExtension`. */
export function mockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

/**
 * Look up the handler passed to `pi.registerCommand(name, opts)` on a
 * `mockPi()` instance. Returns `undefined` if no command with that name was
 * registered.
 */
export function getRegisteredCommandHandler(pi: ReturnType<typeof mockPi>, name: string) {
  const call = pi.registerCommand.mock.calls.find((c: unknown[]) => c[0] === name);
  return call ? (call[1] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler : undefined;
}

/**
 * Look up the handler passed to `pi.registerShortcut(key, opts)` on a
 * `mockPi()` instance. Returns `undefined` if no shortcut with that key was
 * registered.
 */
export function getRegisteredShortcutHandler(pi: ReturnType<typeof mockPi>, key: string) {
  const call = pi.registerShortcut.mock.calls.find((c: unknown[]) => c[0] === key);
  return call ? (call[1] as { handler: (ctx: unknown) => Promise<void> }).handler : undefined;
}

/**
 * Create a minimal `ExtensionConfig` for tests that exercise
 * `createForgeflowExtension`, `registerForgeflowTool`, or
 * `registerForgeflowCommands`. Defaults provide two pipelines (`alpha`,
 * `beta`) and two commands (one with `parseArgs`, one without). Override any
 * field via the `overrides` argument.
 */
export function mockExtensionConfig(overrides?: Partial<ExtensionConfig>): ExtensionConfig {
  return {
    toolName: "forgeflow-test",
    toolLabel: "Forgeflow Test",
    description: "Test extension",
    params: {
      issue: { type: "string", description: "Issue number" },
      verbose: { type: "boolean", description: "Verbose output" },
      count: { type: "number", description: "Iteration count" },
    },
    pipelines: [
      {
        name: "alpha",
        execute: vi.fn(async () => ({
          content: [{ type: "text" as const, text: "alpha done" }],
          details: { pipeline: "alpha", stages: [] } as PipelineDetails,
        })),
      },
      {
        name: "beta",
        execute: vi.fn(async () => ({
          content: [{ type: "text" as const, text: "beta done" }],
          details: { pipeline: "beta", stages: [] } as PipelineDetails,
        })),
      },
    ],
    commands: [
      {
        name: "alpha-cmd",
        description: "Run alpha",
        pipeline: "alpha",
        parseArgs: (args) => ({
          params: { issue: args.trim() },
          suffix: "Do not interpret.",
        }),
      },
      {
        name: "beta-cmd",
        description: "Run beta",
        pipeline: "beta",
      },
    ],
    ...overrides,
  };
}

/** Create a minimal ForgeflowContext for testing. All UI methods are no-op stubs. */
export function mockForgeflowContext(overrides?: {
  hasUI?: boolean;
  cwd?: string;
  ui?: Partial<ForgeflowUI>;
  sessionManager?: Partial<ForgeflowContext["sessionManager"]>;
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
      notify: () => {},
      custom: (async () => undefined as never) as ForgeflowUI["custom"],
      theme: mockTheme(),
      ...overrides?.ui,
    },
    sessionManager: {
      getBranch: () => [],
      ...overrides?.sessionManager,
    },
  };
}
