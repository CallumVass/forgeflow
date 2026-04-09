import { describe, expect, it, vi } from "vitest";
import type { OnUpdate, PipelineDetails } from "../pipeline.js";
import { makeStage, mockExtensionConfig, mockForgeflowContext, mockPi, mockTheme } from "../test-utils.js";
import { buildSchema } from "./schema.js";
import { registerForgeflowTool } from "./tool.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function getToolDef(pi: ReturnType<typeof mockPi>) {
  // biome-ignore lint/style/noNonNullAssertion: test helper accessing mock calls by known index
  return pi.registerTool.mock.calls[0]![0]!;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("registerForgeflowTool", () => {
  it("registers a tool whose execute dispatches to the matching pipeline with cwd, params, signal, wrapped onUpdate, and ctx", async () => {
    const pi = mockPi();
    const config = mockExtensionConfig();
    registerForgeflowTool(pi as never, config, buildSchema(config));

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const toolDef = getToolDef(pi);
    // Tool identity matches the config.
    expect(toolDef.name).toBe("forgeflow-test");
    expect(toolDef.label).toBe("Forgeflow Test");
    expect(toolDef.description).toBe("Test extension");

    // Invoking execute dispatches to the pipeline named by params.pipeline.
    const ctx = mockForgeflowContext({ cwd: "/test" });
    const signal = new AbortController().signal;
    const onUpdate = vi.fn();

    const result = await toolDef.execute("call-1", { pipeline: "alpha", issue: "42" }, signal, onUpdate, ctx);

    // biome-ignore lint/style/noNonNullAssertion: test accessing known array index
    expect(config.pipelines[0]!.execute).toHaveBeenCalledWith(
      "/test",
      { pipeline: "alpha", issue: "42" },
      signal,
      expect.any(Function),
      ctx,
    );
    expect(result.content[0]).toEqual({ type: "text", text: "alpha done" });
  });

  it("returns an error result whose first text begins with 'Unknown pipeline:' for an unknown pipeline name", async () => {
    const pi = mockPi();
    const config = mockExtensionConfig();
    registerForgeflowTool(pi as never, config, buildSchema(config));

    const toolDef = getToolDef(pi);
    const ctx = mockForgeflowContext();

    const result = await toolDef.execute("call-1", { pipeline: "nope" }, undefined, undefined, ctx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Unknown pipeline: nope"),
    });
    // The error message lists every available pipeline name.
    expect((result.content[0] as { text: string }).text).toContain("alpha");
    expect((result.content[0] as { text: string }).text).toContain("beta");
    expect(result.details).toEqual({ pipeline: "nope", stages: [] });
  });

  it("clears UI status and widget in finally on both success and error paths", async () => {
    const setStatus = vi.fn();
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: true, ui: { setStatus, setWidget } });

    const pi = mockPi();
    const config = mockExtensionConfig({
      pipelines: [
        {
          name: "alpha",
          execute: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
        {
          name: "beta",
          execute: vi.fn(async () => ({
            content: [{ type: "text" as const, text: "ok" }],
            details: { pipeline: "beta", stages: [] } as PipelineDetails,
          })),
        },
      ],
    });
    registerForgeflowTool(pi as never, config, buildSchema(config));

    const toolDef = getToolDef(pi);

    // Success case
    await toolDef.execute("c1", { pipeline: "beta" }, undefined, undefined, ctx);
    expect(setStatus).toHaveBeenCalledWith("forgeflow-test", undefined);
    expect(setWidget).toHaveBeenCalledWith("forgeflow-test", undefined);

    setStatus.mockClear();
    setWidget.mockClear();

    // Error case — finally still runs and the error still propagates
    await expect(toolDef.execute("c2", { pipeline: "alpha" }, undefined, undefined, ctx)).rejects.toThrow("boom");
    expect(setStatus).toHaveBeenCalledWith("forgeflow-test", undefined);
    expect(setWidget).toHaveBeenCalledWith("forgeflow-test", undefined);
  });

  it("repaints the widget on every onUpdate frame and clears it in finally when hasUI=true", async () => {
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: true, ui: { setWidget } });

    const pi = mockPi();
    const config = mockExtensionConfig({
      pipelines: [
        {
          name: "alpha",
          execute: vi.fn(async (_cwd, _params, _signal, onUpdate: OnUpdate) => {
            // Frame 1: planner running, two more pending → 0/3
            onUpdate({
              content: [{ type: "text" as const, text: "..." }],
              details: {
                pipeline: "alpha",
                stages: [
                  makeStage({ name: "planner", status: "running" }),
                  makeStage({ name: "implementor", status: "pending" }),
                  makeStage({ name: "reviewer", status: "pending" }),
                ],
              },
            });
            // Frame 2: planner done, implementor running → 1/3
            onUpdate({
              content: [{ type: "text" as const, text: "..." }],
              details: {
                pipeline: "alpha",
                stages: [
                  makeStage({ name: "planner", status: "done" }),
                  makeStage({ name: "implementor", status: "running" }),
                  makeStage({ name: "reviewer", status: "pending" }),
                ],
              },
            });
            return {
              content: [{ type: "text" as const, text: "ok" }],
              details: { pipeline: "alpha", stages: [] } as PipelineDetails,
            };
          }),
        },
      ],
    });
    registerForgeflowTool(pi as never, config, buildSchema(config));

    const toolDef = getToolDef(pi);
    await toolDef.execute("c1", { pipeline: "alpha" }, undefined, vi.fn(), ctx);

    const liveCalls = setWidget.mock.calls.filter((c: unknown[]) => c[0] === "forgeflow-test" && Array.isArray(c[1]));
    expect(liveCalls.length).toBeGreaterThanOrEqual(2);

    const firstFrame = (liveCalls[0]?.[1] as string[]).join("\n");
    expect(firstFrame).toContain("planner");
    expect(firstFrame).toContain("0/3");

    const secondFrame = (liveCalls[1]?.[1] as string[]).join("\n");
    expect(secondFrame).toContain("implementor");
    expect(secondFrame).toContain("1/3");

    // Final clear from the finally block.
    const lastCall = setWidget.mock.calls[setWidget.mock.calls.length - 1];
    expect(lastCall).toEqual(["forgeflow-test", undefined]);
  });

  it("does not call setWidget when ctx.hasUI is false", async () => {
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: false, ui: { setWidget } });

    const pi = mockPi();
    const config = mockExtensionConfig({
      pipelines: [
        {
          name: "alpha",
          execute: vi.fn(async (_cwd, _params, _signal, onUpdate: OnUpdate) => {
            onUpdate({
              content: [{ type: "text" as const, text: "running..." }],
              details: {
                pipeline: "alpha",
                stages: [makeStage({ name: "planner", status: "running" })],
              },
            });
            return {
              content: [{ type: "text" as const, text: "ok" }],
              details: { pipeline: "alpha", stages: [] } as PipelineDetails,
            };
          }),
        },
      ],
    });
    registerForgeflowTool(pi as never, config, buildSchema(config));

    const toolDef = getToolDef(pi);
    await expect(toolDef.execute("c1", { pipeline: "alpha" }, undefined, vi.fn(), ctx)).resolves.toBeDefined();
    expect(setWidget).not.toHaveBeenCalled();
  });

  it("renderCall returns a Text node with bold tool name, accent pipeline, and renderCallExtra output", () => {
    const pi = mockPi();
    const config = mockExtensionConfig({
      renderCallExtra: (args, theme) => {
        if (args.issue) return theme.fg("dim", ` #${args.issue}`);
        return "";
      },
    });
    registerForgeflowTool(pi as never, config, buildSchema(config));

    const toolDef = getToolDef(pi);
    const theme = mockTheme();

    const node = toolDef.renderCall({ pipeline: "alpha", issue: "42" }, theme, {});
    const text = node.render(120).join("\n");

    expect(text).toContain("**forgeflow-test **");
    expect(text).toContain("[accent]alpha");
    expect(text).toContain("[dim] #42");
  });

  it("renderResult delegates to the shared stage renderer with the configured tool name", () => {
    const pi = mockPi();
    const config = mockExtensionConfig();
    registerForgeflowTool(pi as never, config, buildSchema(config));

    const toolDef = getToolDef(pi);
    const theme = mockTheme();
    const result = {
      content: [{ type: "text" as const, text: "done" }],
      details: { pipeline: "alpha", stages: [] } as PipelineDetails,
    };

    const node = toolDef.renderResult(result, { expanded: false }, theme, {});
    expect(node.render(120).join("\n")).toContain("done");
  });
});
