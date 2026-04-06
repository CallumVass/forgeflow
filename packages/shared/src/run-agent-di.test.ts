import { describe, expect, it, vi } from "vitest";
import { emptyStage, type RunAgentOpts } from "./pipeline.js";

const stubOpts: RunAgentOpts = {
  agentsDir: "/agents",
  cwd: "/tmp",
  stages: [],
  pipeline: "test",
};

describe("resolveRunAgent", () => {
  it("returns the injected function when one is provided", async () => {
    const { resolveRunAgent } = await import("./run-agent.js");
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
    const { resolveRunAgent, runAgent } = await import("./run-agent.js");

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
