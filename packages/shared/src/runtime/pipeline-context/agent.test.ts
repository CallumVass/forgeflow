import { describe, expect, it, vi } from "vitest";
import type { PipelineAgentRuntime } from "./agent.js";
import { toAgentOpts } from "./agent.js";

describe("pipeline-context/toAgentOpts", () => {
  it("forwards the agent runtime fields required by RunAgentOpts", () => {
    const runtime: PipelineAgentRuntime = {
      cwd: "/project",
      signal: AbortSignal.timeout(1000),
      onUpdate: vi.fn(),
      agentsDir: "/agents",
      runAgentFn: vi.fn(),
      agentOverrides: { planner: { model: "claude-opus-4-5" } },
      selectedSkills: [{ name: "tailwind", filePath: "/skills/tailwind/SKILL.md", reasons: ["UI work"] }],
    };

    const result = toAgentOpts(runtime, { stages: [], pipeline: "review" });

    expect(result).toEqual({
      cwd: "/project",
      signal: runtime.signal,
      onUpdate: runtime.onUpdate,
      agentsDir: "/agents",
      agentOverrides: { planner: { model: "claude-opus-4-5" } },
      selectedSkills: [{ name: "tailwind", filePath: "/skills/tailwind/SKILL.md", reasons: ["UI work"] }],
      stages: [],
      pipeline: "review",
    });
  });
});
