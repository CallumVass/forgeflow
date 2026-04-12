import { getRegisteredToolDefinition, mockForgeflowContext, mockPi } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createDevExtension from "./index.js";

const {
  runImplement,
  runImplementAll,
  runReview,
  runArchitecture,
  runSkillScan,
  runSkillRecommend,
  runAtlassianRead,
  runDatadog,
  handleDevResult,
  rememberCommandInvocation,
  registerDatadogCommands,
} = vi.hoisted(() => ({
  runImplement: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "implement done" }],
    details: { pipeline: "implement", stages: [] },
  })),
  runImplementAll: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "implement-all done" }],
    details: { pipeline: "implement-all", stages: [] },
  })),
  runReview: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "review done" }],
    details: { pipeline: "review", stages: [] },
  })),
  runArchitecture: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "architecture done" }],
    details: { pipeline: "architecture", stages: [] },
  })),
  runSkillScan: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "scan done" }],
    details: { pipeline: "skill-scan", stages: [] },
  })),
  runSkillRecommend: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "recommend done" }],
    details: { pipeline: "skill-recommend", stages: [] },
  })),
  runAtlassianRead: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "read done" }],
    details: { pipeline: "atlassian-read", stages: [] },
  })),
  runDatadog: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "datadog done" }],
    details: { pipeline: "datadog", stages: [] },
  })),
  handleDevResult: vi.fn(async () => {}),
  rememberCommandInvocation: vi.fn(),
  registerDatadogCommands: vi.fn(),
}));

vi.mock("../pipelines/implement/index.js", () => ({ runImplement }));
vi.mock("../pipelines/implement-all/index.js", () => ({ runImplementAll }));
vi.mock("../pipelines/review/index.js", () => ({ runReview }));
vi.mock("../pipelines/architecture/index.js", () => ({ runArchitecture }));
vi.mock("../skills/index.js", () => ({ runSkillScan, runSkillRecommend }));
vi.mock("../pipelines/atlassian-read.js", () => ({ runAtlassianRead }));
vi.mock("../pipelines/datadog/index.js", () => ({ runDatadog }));
vi.mock("../result-actions/index.js", () => ({ handleDevResult }));
vi.mock("../command-launchers/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../command-launchers/index.js")>();
  return {
    ...actual,
    rememberCommandInvocation,
  };
});
vi.mock("../datadog/commands.js", () => ({ registerDatadogCommands }));

describe("dev extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers forgeflow-dev with the current dev commands, Atlassian commands, Datadog commands, and post-run actions", async () => {
    const pi = mockPi();

    createDevExtension("file:///repo/packages/dev/extensions/index.js")(pi as never);

    const toolDef = getRegisteredToolDefinition(pi);
    expect(toolDef.name).toBe("forgeflow-dev");
    expect(toolDef.parameters.properties.pipeline.description).toContain('"implement"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"implement-all"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"review"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"architecture"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"skill-scan"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"skill-recommend"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"atlassian-read"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"datadog"');
    expect(pi.registerCommand.mock.calls.map((call: unknown[]) => call[0])).toEqual(
      expect.arrayContaining([
        "implement",
        "implement-all",
        "review",
        "review-lite",
        "architecture",
        "skill-scan",
        "skill-recommend",
      ]),
    );
    expect(pi.registerCommand.mock.calls.map((call: unknown[]) => call[0])).toEqual(
      expect.arrayContaining(["atlassian-login", "atlassian-status", "atlassian-logout", "atlassian-read"]),
    );
    expect(registerDatadogCommands).toHaveBeenCalledWith(pi);

    const ctx = mockForgeflowContext({ hasUI: true });
    await toolDef.execute(
      "call-1",
      { pipeline: "implement", issue: "42", skipReview: true },
      AbortSignal.timeout(5000),
      vi.fn(),
      ctx,
    );
    expect(handleDevResult).toHaveBeenCalledWith(
      { pipeline: "implement", issue: "42", skipReview: true },
      expect.objectContaining({ details: { pipeline: "implement", stages: [] } }),
      ctx,
      expect.objectContaining({ openStages: expect.any(Function), queueFollowUp: expect.any(Function) }),
    );
  });

  it("executes dev pipelines with a PipelineContext built from the package agents directory", async () => {
    const pi = mockPi();
    createDevExtension("file:///repo/packages/dev/extensions/index.js")(pi as never);

    const toolDef = getRegisteredToolDefinition(pi);
    const ctx = mockForgeflowContext({ cwd: "/repo/project", hasUI: true });
    await toolDef.execute(
      "call-1",
      { pipeline: "implement", issue: "42", skipPlan: true, skipReview: true },
      AbortSignal.timeout(5000),
      vi.fn(),
      ctx,
    );

    expect(runImplement).toHaveBeenCalledWith(
      "42",
      expect.objectContaining({
        cwd: "/repo/project",
        ctx,
        agentsDir: "/repo/packages/dev/agents",
      }),
      { skipPlan: true, skipReview: true },
    );
  });
});
