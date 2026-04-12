import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import type { ExtensionConfig } from "../extension/index.js";
import type { ForgeflowContext, ForgeflowTheme, ForgeflowUI } from "../runtime/index.js";
import { emptyStage, type PipelineDetails, type StageResult } from "../runtime/index.js";

/**
 * Register `beforeEach` / `afterEach` hooks in the enclosing describe that
 * stub `$HOME` to a fresh temp directory and allocate a second temp directory.
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

/** Create a minimal mock of pi's ExtensionAPI surface used by `createForgeflowExtension`. */
export function mockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    on: vi.fn(),
    exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false })),
  };
}

export function getRegisteredCommandHandler(pi: ReturnType<typeof mockPi>, name: string) {
  const call = pi.registerCommand.mock.calls.find((c: unknown[]) => c[0] === name);
  return call ? (call[1] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler : undefined;
}

export function getRegisteredShortcutHandler(pi: ReturnType<typeof mockPi>, key: string) {
  const call = pi.registerShortcut.mock.calls.find((c: unknown[]) => c[0] === key);
  return call ? (call[1] as { handler: (ctx: unknown) => Promise<void> }).handler : undefined;
}

/**
 * Create a minimal `ExtensionConfig` for tests that exercise
 * `createForgeflowExtension`, `registerForgeflowTool`, or
 * `registerForgeflowCommands`.
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
      setFooter: () => {},
      setEditorText: () => {},
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
