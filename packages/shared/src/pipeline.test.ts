import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanSignal,
  emitUpdate,
  getLastToolCall,
  type PipelineContext,
  pipelineResult,
  readSignal,
  resolveAgentsDir,
  SIGNALS,
  signalExists,
  TOOLS_ALL,
  TOOLS_NO_EDIT,
  TOOLS_READONLY,
  toAgentOpts,
  toPipelineContext,
} from "./pipeline.js";
import { makeAssistantMessage, makeStage, mockForgeflowContext } from "./test-utils.js";

// ─── Constants ────────────────────────────────────────────────────────

describe("constants", () => {
  it("exports tool lists and signal map", () => {
    expect(TOOLS_ALL).toEqual(["read", "write", "edit", "bash", "grep", "find"]);
    expect(TOOLS_READONLY).toEqual(["read", "bash", "grep", "find"]);
    expect(TOOLS_NO_EDIT).toEqual(["read", "write", "bash", "grep", "find"]);
    expect(SIGNALS).toEqual({ questions: "QUESTIONS.md", findings: "FINDINGS.md", blocked: "BLOCKED.md" });
  });
});

describe("resolveAgentsDir", () => {
  it("resolves relative to the directory of the URL, not the shared package", () => {
    const url1 = pathToFileURL("/packages/dev/dist/index.js").href;
    const url2 = pathToFileURL("/packages/pm/dist/index.js").href;

    expect(resolveAgentsDir(url1)).toBe(path.resolve("/packages/dev", "agents"));
    expect(resolveAgentsDir(url2)).toBe(path.resolve("/packages/pm", "agents"));
    expect(resolveAgentsDir(url1)).not.toBe(resolveAgentsDir(url2));
  });
});

// ─── Stage / Usage helpers ────────────────────────────────────────────

describe("pipelineResult", () => {
  it("returns correct shape and omits isError when falsy", () => {
    const stages = [makeStage({ name: "planner" })];
    const result = pipelineResult("Done.", "implement", stages);
    expect(result).toEqual({
      content: [{ type: "text", text: "Done." }],
      details: { pipeline: "implement", stages },
    });
    expect(result).not.toHaveProperty("isError");

    const err = pipelineResult("Fail.", "review", stages, true);
    expect(err.isError).toBe(true);
  });
});

// ─── Context builders ─────────────────────────────────────────────────

describe("toPipelineContext", () => {
  it("bundles arguments into a PipelineContext", () => {
    const ctx = mockForgeflowContext();
    const signal = AbortSignal.timeout(5000);
    const onUpdate = vi.fn();
    const pctx = toPipelineContext("/tmp/test", signal, onUpdate, ctx, "/my/agents");

    expect(pctx).toEqual({ cwd: "/tmp/test", signal, onUpdate, ctx, agentsDir: "/my/agents" });
  });
});

describe("toAgentOpts", () => {
  it("converts PipelineContext + extras into RunAgentOpts", () => {
    const onUpdate = vi.fn();
    const pctx: PipelineContext = {
      cwd: "/project",
      signal: AbortSignal.timeout(1000),
      onUpdate,
      ctx: mockForgeflowContext(),
      agentsDir: "/a",
    };
    const result = toAgentOpts(pctx, { stages: [], pipeline: "review" });

    expect(result).toEqual({
      cwd: "/project",
      signal: pctx.signal,
      onUpdate,
      agentsDir: "/a",
      stages: [],
      pipeline: "review",
    });
  });
});

// ─── Signals (filesystem) ─────────────────────────────────────────────

describe("signal functions", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("signalExists / readSignal / cleanSignal lifecycle", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-test-"));
    const filePath = path.join(tmpDir, SIGNALS.blocked);
    fs.writeFileSync(filePath, "blocked reason");

    expect(signalExists(tmpDir, "blocked")).toBe(true);
    expect(readSignal(tmpDir, "blocked")).toBe("blocked reason");

    cleanSignal(tmpDir, "blocked");
    expect(signalExists(tmpDir, "blocked")).toBe(false);
    expect(readSignal(tmpDir, "blocked")).toBeNull();
  });

  it("readSignal returns null for missing signal", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-test-"));
    expect(readSignal(tmpDir, "findings")).toBeNull();
    expect(signalExists(tmpDir, "findings")).toBe(false);
  });
});

// ─── Progress ─────────────────────────────────────────────────────────

describe("getLastToolCall", () => {
  it.each([
    ["bash with command", [{ type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }], "$ ls"],
    ["bash without command", [{ type: "toolCall", id: "t", name: "bash", arguments: {} }], "$ ..."],
    ["no tool calls", [{ type: "text", text: "just text" }], ""],
  ])("%s", (_label, content, expected) => {
    const messages = content.length ? [makeAssistantMessage({ content })] : [];
    expect(getLastToolCall(content.length ? messages : [])).toBe(expected);
  });

  it("returns empty string for empty messages", () => {
    expect(getLastToolCall([])).toBe("");
  });
});

describe("emitUpdate", () => {
  it("calls onUpdate with running stage tool info or status messages", () => {
    const onUpdate = vi.fn();

    // Running with tool call
    emitUpdate({
      stages: [
        makeStage({
          name: "planner",
          status: "running",
          messages: [
            makeAssistantMessage({
              content: [{ type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }],
            }),
          ],
        }),
      ],
      pipeline: "implement",
      onUpdate,
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: "text", text: "[planner] $ ls" }] }),
    );

    // All done
    onUpdate.mockClear();
    emitUpdate({
      stages: [makeStage({ status: "done" }), makeStage({ status: "done" })],
      pipeline: "test",
      onUpdate,
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: "text", text: "Pipeline complete" }] }),
    );
  });

  it("is a no-op when onUpdate is undefined", () => {
    expect(() => emitUpdate({ stages: [], pipeline: "test" })).not.toThrow();
  });
});
