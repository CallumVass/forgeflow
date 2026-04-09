import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, type Mock, vi } from "vitest";
import type { ExecFn } from "./exec.js";
import type { ExtensionConfig } from "./extension-types.js";
import type {
  ForgeflowContext,
  ForgeflowCustomFactory,
  ForgeflowCustomOptions,
  ForgeflowTheme,
  ForgeflowUI,
  PipelineContext,
} from "./pipeline.js";
import { emptyStage, type PipelineDetails, type RunAgentFn, type StageResult } from "./pipeline.js";

/**
 * Register `beforeEach` / `afterEach` hooks in the enclosing describe that
 * stub `$HOME` to a fresh temp directory and allocate a second temp directory
 * (typically used as `cwd` or a project root). Both dirs are removed and
 * `HOME` is unstubbed after each test.
 *
 * Returns a live fixture handle — read `.homeDir` / `.cwdDir` inside test
 * bodies (they are reassigned by `beforeEach` before every test). Use this
 * anywhere a test exercises `loadForgeflowConfig`, `toPipelineContext`, or
 * any other on-disk `$HOME`-reading helper so the user's real
 * `~/.pi/agent/forgeflow.json` can't contaminate tests.
 */
export function setupIsolatedHomeFixture(label: string): { homeDir: string; cwdDir: string } {
  const fixture = { homeDir: "", cwdDir: "" };
  beforeEach(() => {
    fixture.homeDir = fs.mkdtempSync(path.join(os.tmpdir(), `forgeflow-${label}-home-`));
    fixture.cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), `forgeflow-${label}-cwd-`));
    vi.stubEnv("HOME", fixture.homeDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
    fs.rmSync(fixture.cwdDir, { recursive: true, force: true });
  });
  return fixture;
}

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
  return vi.fn(async (agent, _prompt, opts) => {
    const name = opts.stageName ?? agent;
    const stage = opts.stages.find((s) => s.name === name);
    if (stage) {
      stage.status = status;
      stage.output = output;
    }
    return {
      ...emptyStage(name),
      output,
      status,
    };
  });
}

/** Create a mock RunAgentFn that returns responses in sequence, one per call. */
export function sequencedRunAgent(
  responses: Array<{ output: string; status?: StageResult["status"] }>,
): Mock<RunAgentFn> {
  let callIndex = 0;
  return vi.fn(async (agent, _prompt, opts) => {
    const response = responses[callIndex] ?? { output: "", status: "done" as const };
    callIndex++;
    const status = response.status ?? ("done" as const);
    const name = opts.stageName ?? agent;
    const stage = opts.stages.find((s) => s.name === name);
    if (stage) {
      stage.status = status;
      stage.output = response.output;
    }
    return { ...emptyStage(name), output: response.output, status };
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

export interface CustomCapture<T> {
  factory: ForgeflowCustomFactory<T>;
  options: ForgeflowCustomOptions | undefined;
  done: (result: T) => void;
  tui: { requestRender: ReturnType<typeof vi.fn> };
}

/**
 * Create a typed `ctx.ui.custom` mock and capture its factory so tests can
 * mount the component and drive it directly.
 */
export function makeCustomUiMock<T>() {
  const captures: CustomCapture<T>[] = [];
  const customFn = vi.fn(async (factory: ForgeflowCustomFactory<T>, options?: ForgeflowCustomOptions) => {
    let resolvePromise: (result: T) => void = () => {};
    const promise = new Promise<T>((resolve) => {
      resolvePromise = resolve;
    });
    const tui = { requestRender: vi.fn() };
    const done = vi.fn((result: T) => {
      resolvePromise(result);
    });
    captures.push({ factory, options, done, tui });
    return promise;
  });

  return {
    custom: customFn as unknown as Mock<ForgeflowUI["custom"]> & ForgeflowUI["custom"],
    captures,
  };
}

export function firstCustomCapture<T>(captures: CustomCapture<T>[]): CustomCapture<T> {
  const capture = captures[0];
  if (!capture) throw new Error("expected at least one ctx.ui.custom call");
  return capture;
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
    agentOverrides: {},
    // Default to persist:false in tests so no code under test ever
    // touches `.forgeflow/run/` unless a test opts in explicitly via
    // overrides. This keeps the test suite fully hermetic.
    sessionsConfig: { persist: false, archiveRuns: 0, archiveMaxAge: 0 },
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
