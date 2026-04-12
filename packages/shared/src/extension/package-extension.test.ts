import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeflowContext, PipelineDetails } from "../runtime/index.js";
import { mockForgeflowContext, mockPi } from "../testing/index.js";
import { createForgeflowPackageExtension } from "./package-extension.js";
import { resetAtlassianCommandRegistry, resetStagesOverlayRegistry } from "./registry.js";

beforeEach(() => {
  resetStagesOverlayRegistry();
  resetAtlassianCommandRegistry();
});

function getSessionStartHandler(pi: ReturnType<typeof mockPi>) {
  const call = pi.on.mock.calls.find((entry: unknown[]) => entry[0] === "session_start");
  return call?.[1] as ((event: unknown, ctx: ForgeflowContext) => Promise<void>) | undefined;
}

function getToolDef(pi: ReturnType<typeof mockPi>) {
  return pi.registerTool.mock.calls[0]?.[0];
}

describe("createForgeflowPackageExtension", () => {
  it("registers the tool, package commands, Atlassian commands, extra commands, and an optional session_start hook", async () => {
    const pi = mockPi();
    const registerExtraCommands = vi.fn((api: typeof pi) => {
      api.registerCommand("extra-cmd", {
        description: "Extra command",
        handler: async () => {},
      });
    });
    const onSessionStart = vi.fn();

    const registerExtension = createForgeflowPackageExtension({
      moduleUrl: "file:///repo/packages/pm/extensions/index.js",
      toolName: "forgeflow-test",
      toolLabel: "Forgeflow Test",
      description: "Test package extension",
      params: {},
      pipelines: [
        {
          name: "alpha",
          run: vi.fn(async () => ({
            content: [{ type: "text" as const, text: "alpha done" }],
            details: { pipeline: "alpha", stages: [] } as PipelineDetails,
          })),
        },
      ],
      commands: [{ name: "alpha-cmd", description: "Run alpha", pipeline: "alpha" }],
      registerExtraCommands,
      onSessionStart,
    });

    registerExtension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand.mock.calls.map((call: unknown[]) => call[0])).toEqual(
      expect.arrayContaining([
        "alpha-cmd",
        "stages",
        "atlassian-login",
        "atlassian-status",
        "atlassian-logout",
        "atlassian-read",
        "extra-cmd",
      ]),
    );
    expect(registerExtraCommands).toHaveBeenCalledWith(pi);

    const sessionStart = getSessionStartHandler(pi);
    expect(sessionStart).toBeDefined();

    const ctx = mockForgeflowContext();
    if (!sessionStart) throw new Error("expected session_start handler");
    await sessionStart({}, ctx);
    expect(onSessionStart).toHaveBeenCalledWith(ctx);
  });

  it("adapts package runners into tool pipelines and builds PipelineContext with the package agents directory", async () => {
    const pi = mockPi();
    const run = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "alpha done" }],
      details: { pipeline: "alpha", stages: [] } as PipelineDetails,
    }));

    createForgeflowPackageExtension({
      moduleUrl: "file:///repo/packages/pm/extensions/index.js",
      toolName: "forgeflow-test",
      toolLabel: "Forgeflow Test",
      description: "Test package extension",
      params: {},
      pipelines: [{ name: "alpha", run }],
      commands: [{ name: "alpha-cmd", description: "Run alpha", pipeline: "alpha" }],
    })(pi as never);

    const toolDef = getToolDef(pi);
    const ctx = mockForgeflowContext({ cwd: "/repo/worktree" });
    await toolDef.execute("call-1", { pipeline: "alpha" }, AbortSignal.timeout(5000), vi.fn(), ctx);

    expect(run).toHaveBeenCalledWith(
      { pipeline: "alpha" },
      expect.objectContaining({
        cwd: "/repo/worktree",
        ctx,
        agentsDir: "/repo/packages/pm/agents",
      }),
    );
  });

  it("registers shared /stages and Atlassian commands once across two package extensions while both tools remain callable", async () => {
    const piA = mockPi();
    const piB = mockPi();
    const runPm = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "pm done" }],
      details: { pipeline: "alpha", stages: [] } as PipelineDetails,
    }));
    const runDev = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "dev done" }],
      details: { pipeline: "beta", stages: [] } as PipelineDetails,
    }));

    createForgeflowPackageExtension({
      moduleUrl: "file:///repo/packages/pm/extensions/index.js",
      toolName: "forgeflow-pm",
      toolLabel: "Forgeflow PM",
      description: "PM package",
      params: {},
      pipelines: [{ name: "alpha", run: runPm }],
      commands: [{ name: "pm-cmd", description: "Run PM", pipeline: "alpha" }],
    })(piA as never);

    createForgeflowPackageExtension({
      moduleUrl: "file:///repo/packages/dev/extensions/index.js",
      toolName: "forgeflow-dev",
      toolLabel: "Forgeflow Dev",
      description: "Dev package",
      params: {},
      pipelines: [{ name: "beta", run: runDev }],
      commands: [{ name: "dev-cmd", description: "Run Dev", pipeline: "beta" }],
    })(piB as never);

    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "stages")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "stages")).toHaveLength(0);
    expect(piA.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-login")).toHaveLength(1);
    expect(piB.registerCommand.mock.calls.filter((call: unknown[]) => call[0] === "atlassian-login")).toHaveLength(0);
    expect(piA.registerTool).toHaveBeenCalledTimes(1);
    expect(piB.registerTool).toHaveBeenCalledTimes(1);

    const pmTool = getToolDef(piA);
    const devTool = getToolDef(piB);
    const ctx = mockForgeflowContext({ cwd: "/repo/project" });
    await pmTool.execute("call-pm", { pipeline: "alpha" }, AbortSignal.timeout(5000), vi.fn(), ctx);
    await devTool.execute("call-dev", { pipeline: "beta" }, AbortSignal.timeout(5000), vi.fn(), ctx);

    expect(runPm).toHaveBeenCalled();
    expect(runDev).toHaveBeenCalled();
  });
});
