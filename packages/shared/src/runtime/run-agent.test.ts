import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAgentSessionMock = vi.hoisted(() => vi.fn());
const modelRegistryCreateMock = vi.hoisted(() => vi.fn(() => ({ find: vi.fn(), getAvailable: vi.fn(() => []) })));
const loaderInstances = vi.hoisted(
  () => [] as Array<{ options: Record<string, unknown>; reload: ReturnType<typeof vi.fn> }>,
);
const createReadToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "read", cwd })));
const createWriteToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "write", cwd })));
const createEditToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "edit", cwd })));
const createBashToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "bash", cwd })));
const createGrepToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "grep", cwd })));
const createFindToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "find", cwd })));
const createLsToolMock = vi.hoisted(() => vi.fn((cwd: string) => ({ toolName: "ls", cwd })));

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();

  class FakeResourceLoader {
    options: Record<string, unknown>;
    reload = vi.fn(async () => {});

    constructor(options: Record<string, unknown>) {
      this.options = options;
      loaderInstances.push(this);
    }
  }

  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
    ModelRegistry: { create: modelRegistryCreateMock },
    DefaultResourceLoader: FakeResourceLoader,
    createReadTool: createReadToolMock,
    createWriteTool: createWriteToolMock,
    createEditTool: createEditToolMock,
    createBashTool: createBashToolMock,
    createGrepTool: createGrepToolMock,
    createFindTool: createFindToolMock,
    createLsTool: createLsToolMock,
  };
});

import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { runAgent } from "./run-agent.js";
import { emptyStage, type RunAgentOpts } from "./stages.js";

interface SessionHarness {
  listeners: Array<(event: unknown) => void>;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  options: Record<string, unknown>;
}

function makeAssistantMessage(text: string, model = "claude-sonnet") {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    model,
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
  };
}

function emit(harness: SessionHarness, event: unknown): void {
  const messageEvent = event as { type?: string; message?: Parameters<SessionManager["appendMessage"]>[0] };
  const sessionManager = harness.options.sessionManager as SessionManager | undefined;
  if (messageEvent.type === "message_end" && messageEvent.message && sessionManager) {
    sessionManager.appendMessage(messageEvent.message);
  }
  for (const listener of harness.listeners) listener(event);
}

function queueSession(script: (harness: SessionHarness) => Promise<void> | void): void {
  createAgentSessionMock.mockImplementationOnce(async (options: Record<string, unknown>) => {
    const listeners: Array<(event: unknown) => void> = [];
    const prompt = vi.fn(async () => {
      await script({ listeners, prompt, abort, dispose, options });
    });
    const abort = vi.fn(async () => {});
    const dispose = vi.fn();
    return {
      session: {
        subscribe: (listener: (event: unknown) => void) => {
          listeners.push(listener);
          return () => {
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        },
        prompt,
        abort,
        dispose,
      },
    };
  });
}

function makeOpts(agentsDir: string, cwd: string): RunAgentOpts {
  return {
    agentsDir,
    cwd,
    stages: [emptyStage("test")],
    pipeline: "test-pipeline",
  };
}

function writeSession(filePath: string, cwd: string, entries: object[] = []): void {
  const header = {
    type: "session",
    version: 3,
    id: "11111111-1111-1111-1111-111111111111",
    timestamp: new Date().toISOString(),
    cwd,
  };
  const lines = `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  fs.writeFileSync(filePath, lines, { mode: 0o600 });
}

describe("runAgent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-run-agent-test-"));
    createAgentSessionMock.mockReset();
    modelRegistryCreateMock.mockReset();
    modelRegistryCreateMock.mockImplementation(() => ({ find: vi.fn(), getAvailable: vi.fn(() => []) }));
    loaderInstances.length = 0;
    createReadToolMock.mockClear();
    createWriteToolMock.mockClear();
    createEditToolMock.mockClear();
    createBashToolMock.mockClear();
    createGrepToolMock.mockClear();
    createFindToolMock.mockClear();
    createLsToolMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(name: string, tools: string, body = "You are a test agent.\n"): void {
    fs.writeFileSync(
      path.join(tmpDir, `${name}.md`),
      `---
name: ${name}
description: Test.
tools: ${tools}
---

${body}`,
    );
  }

  it("derives tool instances from the agent frontmatter", async () => {
    writeAgent("test-agent", "read, write, edit, bash, grep, find");
    queueSession((harness) => {
      emit(harness, { type: "message_end", message: makeAssistantMessage("done") });
    });

    const opts = { ...makeOpts(tmpDir, tmpDir), stages: [emptyStage("test-agent")] };
    await runAgent("test-agent", "do stuff", opts);

    expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
    const call = createAgentSessionMock.mock.calls[0]?.[0] as { tools: Array<{ toolName: string }> };
    expect(call.tools.map((tool) => tool.toolName)).toEqual(["read", "write", "edit", "bash", "grep", "find"]);
  });

  it("throws and does not create a session when the agent file is missing", async () => {
    const opts = { ...makeOpts(tmpDir, tmpDir), stages: [emptyStage("ghost")] };

    await expect(runAgent("ghost", "", opts)).rejects.toThrow(/missing/);
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it("materialises a fork into sessionPath before opening the SDK session", async () => {
    writeAgent("test-agent", "read, bash");
    const source = path.join(tmpDir, "source.jsonl");
    const target = path.join(tmpDir, "target.jsonl");
    writeSession(source, tmpDir, [
      {
        type: "message",
        id: "aaaaaaaa",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: "hello" },
      },
    ]);
    fs.writeFileSync(target, "", { mode: 0o600 });

    queueSession((harness) => {
      emit(harness, { type: "message_end", message: makeAssistantMessage("done") });
    });

    const opts = {
      ...makeOpts(tmpDir, tmpDir),
      stages: [emptyStage("test-agent")],
      sessionPath: target,
      forkFrom: source,
    };

    await runAgent("test-agent", "do stuff", opts);

    const targetContents = fs.readFileSync(target, "utf-8");
    expect(targetContents).toContain(`"parentSession":"${source}"`);
    expect(targetContents).toContain('"role":"user"');

    const call = createAgentSessionMock.mock.calls[0]?.[0] as { sessionManager: SessionManager };
    expect(call.sessionManager.getSessionFile()).toBe(target);
  });

  it("appends a hidden stage handoff to persisted sessions", async () => {
    writeAgent("planner", "read, bash");
    const target = path.join(tmpDir, "planner.jsonl");
    fs.writeFileSync(target, "", { mode: 0o600 });

    queueSession((harness) => {
      emit(harness, { type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } });
      emit(harness, { type: "tool_execution_start", toolName: "bash", args: { command: "npm run check" } });
      emit(harness, { type: "message_end", message: makeAssistantMessage("## Plan\n- Ship it") });
    });

    const opts = {
      ...makeOpts(tmpDir, tmpDir),
      stages: [emptyStage("planner")],
      sessionPath: target,
    };

    const result = await runAgent("planner", "plan it", opts);

    expect(result.status, result.stderr || result.output).toBe("done");
    expect(result.output).toContain("Ship it");

    const contents = fs.readFileSync(target, "utf-8");
    expect(contents).toContain('"customType":"forgeflow-context-note"');
    expect(contents).toContain("Forgeflow stage handoff: planner");
    expect(contents).toContain("src/foo.ts");
    expect(contents).toContain("npm run check");
  });

  it("passes selected skills into the loader and appends agent guidance to the system prompt", async () => {
    writeAgent("planner", "read, grep, find", "Agent prompt body.");
    const skillDir = path.join(tmpDir, "tailwind");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillPath, "---\nname: tailwind\ndescription: Tailwind\n---\n\n# Tailwind\n", "utf-8");

    queueSession((harness) => {
      emit(harness, { type: "message_end", message: makeAssistantMessage("done") });
    });

    await runAgent("planner", "do stuff", {
      ...makeOpts(tmpDir, tmpDir),
      stages: [emptyStage("planner")],
      selectedSkills: [
        {
          name: "tailwind",
          description: "Tailwind guidance",
          filePath: skillPath,
          score: 42,
          reasons: ["package.json depends on tailwindcss"],
          root: { path: skillDir, scope: "project", harness: "claude", distance: 0, precedence: 1 },
        },
      ],
    });

    const loader = loaderInstances[0];
    expect(loader).toBeDefined();
    expect(loader?.options.additionalSkillPaths).toEqual([skillPath]);

    const appendOverride = loader?.options.appendSystemPromptOverride as ((base: string[]) => string[]) | undefined;
    expect(appendOverride).toBeDefined();
    const appended = appendOverride?.(["base prompt"]) ?? [];
    expect(appended.join("\n\n")).toContain("Preselected cross-agent skills");
    expect(appended.join("\n\n")).toContain(skillPath);
    expect(appended.join("\n\n")).toContain("Agent prompt body.");
  });

  it("applies per-agent model and thinking overrides via resolveCliModel", async () => {
    writeAgent("planner", "read, grep, find");
    const find = vi.fn(() => ({ id: "claude-opus-4-5", provider: "anthropic" }));
    modelRegistryCreateMock.mockReturnValue({ find, getAvailable: vi.fn(() => []) });
    queueSession((harness) => {
      emit(harness, { type: "message_end", message: makeAssistantMessage("done", "claude-opus-4-5") });
    });

    await runAgent("planner", "do stuff", {
      ...makeOpts(tmpDir, tmpDir),
      stages: [emptyStage("planner")],
      agentOverrides: {
        planner: { model: "anthropic/claude-opus-4-5", thinkingLevel: "medium" },
      },
    });

    const call = createAgentSessionMock.mock.calls[0]?.[0] as { model: { id: string }; thinkingLevel: string };
    expect(call.model.id).toBe("claude-opus-4-5");
    expect(call.thinkingLevel).toBe("medium");
  });
});
