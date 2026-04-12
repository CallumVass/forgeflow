import { type Mock, vi } from "vitest";
import type { ExecFn } from "../../io/index.js";
import { mockForgeflowContext } from "../../testing/core.js";
import { emptyStage, type RunAgentFn, type StageResult } from "../index.js";
import type { PipelineAgentRuntime } from "./agent.js";
import type { PipelineContext } from "./context.js";
import type { PipelineExecRuntime } from "./exec.js";
import type { PipelineSessionLifecycleRuntime, PipelineSessionRuntime } from "./session.js";
import type { PipelineSkillSelectionRuntime } from "./skills.js";
import type { PipelineUiRuntime } from "./ui.js";

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
 * Falls through to an empty string when no pattern matches.
 */
export function mockExecFn(responses: Record<string, string> = {}): Mock<ExecFn> {
  return vi.fn(async (cmd: string, _cwd?: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    return "";
  });
}

export function mockPipelineAgentRuntime(overrides?: Partial<PipelineAgentRuntime>): PipelineAgentRuntime {
  return {
    cwd: "/tmp/test",
    signal: AbortSignal.timeout(5000),
    onUpdate: undefined,
    agentsDir: "/tmp/agents",
    runAgentFn: mockRunAgent(),
    agentOverrides: {},
    selectedSkills: [],
    ...overrides,
  };
}

export function mockPipelineExecRuntime(overrides?: Partial<PipelineExecRuntime>): PipelineExecRuntime {
  return {
    cwd: "/tmp/test",
    execFn: vi.fn(async () => "") as Mock<ExecFn>,
    execSafeFn: vi.fn(async () => "") as Mock<ExecFn>,
    ...overrides,
  };
}

export function mockPipelineUiRuntime(overrides?: Partial<PipelineUiRuntime>): PipelineUiRuntime {
  return {
    ctx: mockForgeflowContext(
      overrides?.ctx
        ? {
            hasUI: overrides.ctx.hasUI,
            cwd: overrides.ctx.cwd,
            ui: overrides.ctx.ui,
            sessionManager: overrides.ctx.sessionManager,
          }
        : undefined,
    ),
    ...overrides,
  };
}

export function mockPipelineSessionRuntime(overrides?: Partial<PipelineSessionRuntime>): PipelineSessionRuntime {
  return {
    cwd: "/tmp/test",
    ctx: mockForgeflowContext(),
    sessionsConfig: { persist: false, archiveRuns: 0, archiveMaxAge: 0 },
    runDir: undefined,
    ...overrides,
  };
}

export function mockPipelineSessionLifecycleRuntime(
  overrides?: Partial<PipelineSessionLifecycleRuntime>,
): PipelineSessionLifecycleRuntime {
  return {
    ...mockPipelineSessionRuntime(overrides),
    runAgentFn: mockRunAgent(),
    ...overrides,
  };
}

export function mockPipelineSkillRuntime(
  overrides?: Partial<PipelineSkillSelectionRuntime>,
): PipelineSkillSelectionRuntime {
  return {
    cwd: "/tmp/test",
    skillsConfig: { enabled: true, extraPaths: [], maxSelected: 4 },
    selectedSkills: [],
    ...overrides,
  };
}

/**
 * Create a minimal PipelineContext for testing. Defaults seam fields to spies so
 * tests never spawn real sub-processes or shell commands.
 */
export function mockPipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    ...mockPipelineAgentRuntime(overrides),
    ...mockPipelineExecRuntime(overrides),
    ...mockPipelineUiRuntime(overrides),
    ...mockPipelineSessionRuntime(overrides),
    skillsConfig: { enabled: true, extraPaths: [], maxSelected: 4 },
    selectedSkills: [],
    ...overrides,
  };
}
