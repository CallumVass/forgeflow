import { describe, expect, it, vi } from "vitest";
import type { ExecFn } from "../../io/index.js";
import {
  mockPipelineAgentRuntime,
  mockPipelineContext,
  mockPipelineExecRuntime,
  mockPipelineSessionLifecycleRuntime,
  mockPipelineSessionRuntime,
  mockPipelineSkillRuntime,
  mockPipelineUiRuntime,
} from "./testing.js";

describe("pipeline-context/testing", () => {
  it("builds focused runtimes and keeps mockPipelineContext as a compatibility composer", () => {
    const agent = mockPipelineAgentRuntime({ agentsDir: "/repo/agents" });
    const exec = mockPipelineExecRuntime({ cwd: "/repo" });
    const ui = mockPipelineUiRuntime();
    const session = mockPipelineSessionRuntime({ cwd: "/repo" });
    const lifecycle = mockPipelineSessionLifecycleRuntime({ cwd: "/repo" });
    const skill = mockPipelineSkillRuntime({ cwd: "/repo" });
    const pctx = mockPipelineContext({ cwd: "/repo", agentsDir: "/repo/agents" });

    expect(agent.cwd).toBe("/tmp/test");
    expect(agent.agentsDir).toBe("/repo/agents");
    expect(vi.isMockFunction(agent.runAgentFn)).toBe(true);
    expect(exec.cwd).toBe("/repo");
    expect(vi.isMockFunction(exec.execFn)).toBe(true);
    expect(ui.ctx.hasUI).toBe(false);
    expect(session.sessionsConfig.persist).toBe(false);
    expect(vi.isMockFunction(lifecycle.runAgentFn)).toBe(true);
    expect(skill.skillsConfig.maxSelected).toBe(4);
    expect(pctx.cwd).toBe("/repo");
    expect(pctx.agentsDir).toBe("/repo/agents");
    expect(vi.isMockFunction(pctx.runAgentFn)).toBe(true);
    expect(vi.isMockFunction(pctx.execFn as ExecFn)).toBe(true);
  });
});
