import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { runAgent } from "./run-agent.js";
import { emptyStage, type RunAgentOpts } from "./stages.js";

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  kill: (sig?: string) => void;
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

function spawnArgsToToolList(args: string[]): string[] {
  const idx = args.indexOf("--tools");
  if (idx === -1 || idx + 1 >= args.length) throw new Error("no --tools argument in spawn args");
  const list = args[idx + 1];
  if (!list) throw new Error("empty --tools argument");
  return list.split(",");
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
    spawnMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function wireSpawnToClose(exitCode = 0): void {
    spawnMock.mockImplementation(() => {
      const proc = makeFakeProc();
      setImmediate(() => proc.emit("close", exitCode));
      return proc;
    });
  }

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

  it("derives --tools from the agent frontmatter (planner → read,bash,grep,find)", async () => {
    writeAgent("test-agent", "read, bash, grep, find");
    // Stage must match the agent name so the pipeline-lookup succeeds.
    const opts = { ...makeOpts(tmpDir, tmpDir), stages: [emptyStage("test-agent")] };
    wireSpawnToClose(0);

    await runAgent("test-agent", "do stuff", opts);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgsToToolList(callArgs)).toEqual(["read", "bash", "grep", "find"]);
  });

  it("derives --tools from the agent frontmatter (full set → read,write,edit,bash,grep,find)", async () => {
    writeAgent("full-agent", "read, write, edit, bash, grep, find");
    const opts = { ...makeOpts(tmpDir, tmpDir), stages: [emptyStage("full-agent")] };
    wireSpawnToClose(0);

    await runAgent("full-agent", "do stuff", opts);

    const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgsToToolList(callArgs)).toEqual(["read", "write", "edit", "bash", "grep", "find"]);
  });

  it("throws and does not spawn when the agent file is missing", async () => {
    const opts = { ...makeOpts(tmpDir, tmpDir), stages: [emptyStage("ghost")] };
    wireSpawnToClose(0);

    await expect(runAgent("ghost", "", opts)).rejects.toThrow(/missing/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("materialises a fork into sessionPath and invokes pi with only --session", async () => {
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

    const opts = {
      ...makeOpts(tmpDir, tmpDir),
      stages: [emptyStage("test-agent")],
      sessionPath: target,
      forkFrom: source,
    };
    wireSpawnToClose(0);

    await runAgent("test-agent", "do stuff", opts);

    const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
    expect(callArgs).toContain("--session");
    expect(callArgs[callArgs.indexOf("--session") + 1]).toBe(target);
    expect(callArgs).not.toContain("--fork");

    const targetContents = fs.readFileSync(target, "utf-8");
    expect(targetContents).toContain(`"parentSession":"${source}"`);
    expect(targetContents).toContain('"role":"user"');
  });

  it("passes --fork when forkFrom is set without sessionPath", async () => {
    writeAgent("test-agent", "read, bash");
    const source = path.join(tmpDir, "source.jsonl");
    writeSession(source, tmpDir);
    const opts = {
      ...makeOpts(tmpDir, tmpDir),
      stages: [emptyStage("test-agent")],
      forkFrom: source,
    };
    wireSpawnToClose(0);

    await runAgent("test-agent", "do stuff", opts);

    const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
    expect(callArgs).toContain("--fork");
    expect(callArgs[callArgs.indexOf("--fork") + 1]).toBe(source);
    expect(callArgs).not.toContain("--no-session");
  });

  describe("agentOverrides", () => {
    it("appends --model and --thinking when both are set for the agent", async () => {
      writeAgent("planner", "read, grep, find");
      const opts = {
        ...makeOpts(tmpDir, tmpDir),
        stages: [emptyStage("planner")],
        agentOverrides: {
          planner: { model: "claude-opus-4-5", thinkingLevel: "high" as const },
        },
      };
      wireSpawnToClose(0);

      await runAgent("planner", "do stuff", opts);

      const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
      expect(callArgs).toContain("--model");
      expect(callArgs[callArgs.indexOf("--model") + 1]).toBe("claude-opus-4-5");
      expect(callArgs).toContain("--thinking");
      expect(callArgs[callArgs.indexOf("--thinking") + 1]).toBe("high");
    });

    it("appends only --thinking when model is absent", async () => {
      writeAgent("planner", "read, grep, find");
      const opts = {
        ...makeOpts(tmpDir, tmpDir),
        stages: [emptyStage("planner")],
        agentOverrides: {
          planner: { thinkingLevel: "medium" as const },
        },
      };
      wireSpawnToClose(0);

      await runAgent("planner", "do stuff", opts);

      const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
      expect(callArgs).not.toContain("--model");
      expect(callArgs).toContain("--thinking");
      expect(callArgs[callArgs.indexOf("--thinking") + 1]).toBe("medium");
    });

    it("appends only --model when thinkingLevel is absent", async () => {
      writeAgent("planner", "read, grep, find");
      const opts = {
        ...makeOpts(tmpDir, tmpDir),
        stages: [emptyStage("planner")],
        agentOverrides: {
          planner: { model: "claude-opus-4-5" },
        },
      };
      wireSpawnToClose(0);

      await runAgent("planner", "do stuff", opts);

      const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
      expect(callArgs).toContain("--model");
      expect(callArgs[callArgs.indexOf("--model") + 1]).toBe("claude-opus-4-5");
      expect(callArgs).not.toContain("--thinking");
    });

    it("adds neither flag when agentOverrides is empty or missing the agent key", async () => {
      writeAgent("planner", "read, grep, find");
      const opts = {
        ...makeOpts(tmpDir, tmpDir),
        stages: [emptyStage("planner")],
        agentOverrides: {
          implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" as const },
        },
      };
      wireSpawnToClose(0);

      await runAgent("planner", "do stuff", opts);

      const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
      expect(callArgs).not.toContain("--model");
      expect(callArgs).not.toContain("--thinking");
    });

    it("looks up overrides by the raw agent name, not stageName", async () => {
      writeAgent("implementor", "read, write, edit, bash, grep, find");
      // Pipeline uses a disambiguating stageName (e.g. "fix-findings"), but the
      // config keys are agent file stems — the override must still apply.
      const opts = {
        ...makeOpts(tmpDir, tmpDir),
        stages: [emptyStage("fix-findings")],
        stageName: "fix-findings",
        agentOverrides: {
          implementor: { model: "claude-sonnet-4-5", thinkingLevel: "medium" as const },
        },
      };
      wireSpawnToClose(0);

      await runAgent("implementor", "do stuff", opts);

      const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
      expect(callArgs[callArgs.indexOf("--model") + 1]).toBe("claude-sonnet-4-5");
      expect(callArgs[callArgs.indexOf("--thinking") + 1]).toBe("medium");
    });
  });
});
