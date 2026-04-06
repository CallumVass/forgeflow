import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { emptyStage, type RunAgentOpts } from "./stage.js";

const stubOpts: RunAgentOpts = {
  agentsDir: "/agents",
  cwd: "/tmp",
  stages: [],
  pipeline: "test",
};

describe("resolveRunAgent", () => {
  it("returns the injected function when one is provided", async () => {
    const { resolveRunAgent } = await import("./di.js");
    const injected = vi.fn(async () => ({
      ...emptyStage("mock"),
      status: "done" as const,
      exitCode: 0,
      output: "mock-output",
    }));

    const result = await resolveRunAgent(injected);

    expect(result).toBe(injected);
  });

  it("returns the real runAgent when no injection is provided", async () => {
    const { resolveRunAgent } = await import("./di.js");
    const { runAgent } = await import("./run-agent.js");

    const result = await resolveRunAgent();

    expect(result).toBe(runAgent);
  });
});

describe("mockRunAgent", () => {
  it("returns a StageResult-shaped object with configurable output and status", async () => {
    const { mockRunAgent } = await import("./test-utils.js");

    const mock = mockRunAgent("test output", "failed");
    const result = await mock("agent", "prompt", stubOpts);

    expect(result).toMatchObject({
      name: "mock",
      output: "test output",
      status: "failed",
      stderr: "",
      exitCode: -1,
      messages: [],
    });
    expect(result.usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 0,
    });
  });

  it("defaults to empty output and done status", async () => {
    const { mockRunAgent } = await import("./test-utils.js");

    const mock = mockRunAgent();
    const result = await mock("agent", "prompt", stubOpts);

    expect(result.output).toBe("");
    expect(result.status).toBe("done");
  });
});

describe("shared index exports", () => {
  it("exports RunAgentFn, RunAgentOpts, and resolveRunAgent from the package index", () => {
    const indexSrc = readFileSync(resolve(__dirname, "index.ts"), "utf-8");
    expect(indexSrc).toContain("resolveRunAgent");
    expect(indexSrc).toContain("RunAgentFn");
    expect(indexSrc).toContain("RunAgentOpts");
  });
});

describe("migration verification", () => {
  it("packages/dev/src/pipelines/run-agent-di.ts no longer exists", () => {
    expect(() => {
      readFileSync(resolve(__dirname, "../../dev/src/pipelines/run-agent-di.ts"), "utf-8");
    }).toThrow();
  });

  it("no 'as RunAgentFn' casts remain in dev or pm packages", () => {
    const devFiles = [
      resolve(__dirname, "../../dev/src/pipelines/planning.ts"),
      resolve(__dirname, "../../dev/src/pipelines/review-orchestrator.ts"),
      resolve(__dirname, "../../dev/src/pipelines/review-comments.ts"),
    ];
    for (const file of devFiles) {
      const src = readFileSync(file, "utf-8");
      expect(src).not.toContain("as RunAgentFn");
    }

    const pmFiles = [resolve(__dirname, "../../pm/src/pipelines/qa-loop.ts")];
    for (const file of pmFiles) {
      const src = readFileSync(file, "utf-8");
      expect(src).not.toContain("as RunAgentFn");
    }
  });

  it("qa-loop.ts contains no local RunAgentFn type definition", () => {
    const src = readFileSync(resolve(__dirname, "../../pm/src/pipelines/qa-loop.ts"), "utf-8");
    expect(src).not.toMatch(/export type RunAgentFn/);
  });

  it("no biome-ignore comments for any-typed agent opts remain in dev or pm", () => {
    const files = [
      resolve(__dirname, "../../dev/src/pipelines/planning.ts"),
      resolve(__dirname, "../../dev/src/pipelines/review-orchestrator.ts"),
      resolve(__dirname, "../../dev/src/pipelines/review-comments.ts"),
      resolve(__dirname, "../../pm/src/pipelines/qa-loop.ts"),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src).not.toMatch(/biome-ignore.*noExplicitAny.*(?:opts|RunAgentFn|DI)/i);
    }
  });

  it("resolveRunAgent does not live in run-agent.ts", () => {
    const src = readFileSync(resolve(__dirname, "run-agent.ts"), "utf-8");
    expect(src).not.toContain("resolveRunAgent");
  });
});
