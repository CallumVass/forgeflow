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
});
