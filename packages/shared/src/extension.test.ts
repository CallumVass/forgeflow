import { describe, expect, it, vi } from "vitest";
import type { ExtensionConfig } from "./extension.js";
import { buildSendMessage, createForgeflowExtension } from "./extension.js";
import type { OnUpdate, PipelineDetails } from "./pipeline.js";
import { makeStage, mockForgeflowContext, mockTheme } from "./test-utils.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

function getToolDef(pi: ReturnType<typeof mockPi>) {
  // biome-ignore lint/style/noNonNullAssertion: test helper accessing mock calls by known index
  return pi.registerTool.mock.calls[0]![0]!;
}

function minimalConfig(overrides?: Partial<ExtensionConfig>): ExtensionConfig {
  return {
    toolName: "forgeflow-test",
    toolLabel: "Forgeflow Test",
    description: "Test extension",
    params: {
      issue: { type: "string", description: "Issue number" },
      verbose: { type: "boolean", description: "Verbose output" },
      count: { type: "number", description: "Iteration count" },
    },
    pipelines: [
      {
        name: "alpha",
        execute: vi.fn(async () => ({
          content: [{ type: "text" as const, text: "alpha done" }],
          details: { pipeline: "alpha", stages: [] } as PipelineDetails,
        })),
      },
      {
        name: "beta",
        execute: vi.fn(async () => ({
          content: [{ type: "text" as const, text: "beta done" }],
          details: { pipeline: "beta", stages: [] } as PipelineDetails,
        })),
      },
    ],
    commands: [
      {
        name: "alpha-cmd",
        description: "Run alpha",
        pipeline: "alpha",
        parseArgs: (args) => ({
          params: { issue: args.trim() },
          suffix: "Do not interpret.",
        }),
      },
      {
        name: "beta-cmd",
        description: "Run beta",
        pipeline: "beta",
      },
    ],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("createForgeflowExtension", () => {
  it("calls pi.registerTool with correct name, label, description, and TypeBox schema matching pipeline params", () => {
    const pi = mockPi();
    const config = minimalConfig();
    const ext = createForgeflowExtension(config);

    ext(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const toolDef = getToolDef(pi);
    expect(toolDef.name).toBe("forgeflow-test");
    expect(toolDef.label).toBe("Forgeflow Test");
    expect(toolDef.description).toBe("Test extension");

    // Schema should have pipeline (required) + all unique params from pipelines (optional)
    const schema = toolDef.parameters;
    expect(schema.type).toBe("object");
    const props = schema.properties;
    expect(props.pipeline).toBeDefined();
    expect(props.issue).toBeDefined();
    expect(props.verbose).toBeDefined();
    expect(props.count).toBeDefined();
    // Pipeline params should be optional (wrapped in Type.Optional → has [Optional] symbol)
    // The pipeline param itself should be required (no Optional wrapper)
    expect(schema.required).toContain("pipeline");
  });

  it("dispatches execute to the correct pipeline based on params.pipeline", async () => {
    const pi = mockPi();
    const config = minimalConfig();
    const ext = createForgeflowExtension(config);
    ext(pi as never);

    const toolDef = getToolDef(pi);
    const ctx = mockForgeflowContext({ cwd: "/test" });
    const signal = new AbortController().signal;
    const onUpdate = vi.fn();

    const result = await toolDef.execute("call-1", { pipeline: "alpha", issue: "42" }, signal, onUpdate, ctx);

    // The pipeline receives the same params/signal/ctx, but a *wrapped* onUpdate
    // (which forwards to the user-supplied callback after repainting the widget).
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

  it("returns an error result for an unknown pipeline name", async () => {
    const pi = mockPi();
    const ext = createForgeflowExtension(minimalConfig());
    ext(pi as never);

    const toolDef = getToolDef(pi);
    const ctx = mockForgeflowContext();

    const result = await toolDef.execute("call-1", { pipeline: "nope" }, undefined, undefined, ctx);

    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Unknown pipeline: nope") });
    expect(result.details).toEqual({ pipeline: "nope", stages: [] });
  });

  it("clears UI status and widget in finally block on both success and error", async () => {
    const setStatus = vi.fn();
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: true, ui: { setStatus, setWidget } });

    const pi = mockPi();
    const failingConfig = minimalConfig({
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
    const ext = createForgeflowExtension(failingConfig);
    ext(pi as never);

    const toolDef = getToolDef(pi);

    // Success case
    await toolDef.execute("c1", { pipeline: "beta" }, undefined, undefined, ctx);
    expect(setStatus).toHaveBeenCalledWith("forgeflow-test", undefined);
    expect(setWidget).toHaveBeenCalledWith("forgeflow-test", undefined);

    setStatus.mockClear();
    setWidget.mockClear();

    // Error case — cleanup should still happen
    await expect(toolDef.execute("c2", { pipeline: "alpha" }, undefined, undefined, ctx)).rejects.toThrow("boom");
    expect(setStatus).toHaveBeenCalledWith("forgeflow-test", undefined);
    expect(setWidget).toHaveBeenCalledWith("forgeflow-test", undefined);
  });

  it("sets the live widget on every onUpdate call during execution and clears it in finally", async () => {
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: true, ui: { setWidget } });

    const pi = mockPi();
    const config = minimalConfig({
      pipelines: [
        {
          name: "alpha",
          execute: vi.fn(async (_cwd, _params, _signal, onUpdate: OnUpdate) => {
            // Simulate a sub-agent driving progress: stage 1 running with one tool call.
            onUpdate({
              content: [{ type: "text" as const, text: "running..." }],
              details: {
                pipeline: "alpha",
                stages: [
                  makeStage({
                    name: "planner",
                    status: "running",
                    messages: [
                      {
                        role: "assistant",
                        content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }],
                      },
                    ] as never,
                  }),
                  makeStage({ name: "implementor", status: "pending" }),
                ],
              },
            });
            return {
              content: [{ type: "text" as const, text: "alpha done" }],
              details: { pipeline: "alpha", stages: [] } as PipelineDetails,
            };
          }),
        },
      ],
    });
    const ext = createForgeflowExtension(config);
    ext(pi as never);

    const toolDef = getToolDef(pi);
    await toolDef.execute("c1", { pipeline: "alpha" }, undefined, vi.fn(), ctx);

    // Widget was set with the tool name as key and a non-undefined string[] payload
    // at least once *during* execution.
    const liveCalls = setWidget.mock.calls.filter((c: unknown[]) => c[0] === "forgeflow-test" && Array.isArray(c[1]));
    expect(liveCalls.length).toBeGreaterThanOrEqual(1);
    const lines = liveCalls[0]?.[1] as string[];
    expect(lines.join("\n")).toContain("planner");

    // Final clear from the finally block.
    const lastCall = setWidget.mock.calls[setWidget.mock.calls.length - 1];
    expect(lastCall).toEqual(["forgeflow-test", undefined]);
  });

  it("does not call setWidget when ctx.hasUI is false", async () => {
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: false, ui: { setWidget } });

    const pi = mockPi();
    const config = minimalConfig({
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
    const ext = createForgeflowExtension(config);
    ext(pi as never);

    const toolDef = getToolDef(pi);
    await expect(toolDef.execute("c1", { pipeline: "alpha" }, undefined, vi.fn(), ctx)).resolves.toBeDefined();
    expect(setWidget).not.toHaveBeenCalled();
  });

  it("updates the widget content as stages transition from one running to the next", async () => {
    const setWidget = vi.fn();
    const ctx = mockForgeflowContext({ hasUI: true, ui: { setWidget } });

    const pi = mockPi();
    const config = minimalConfig({
      pipelines: [
        {
          name: "alpha",
          execute: vi.fn(async (_cwd, _params, _signal, onUpdate: OnUpdate) => {
            // First frame: planner running, two more pending → 0/3
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
            // Second frame: planner done, implementor running → 1/3
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
    const ext = createForgeflowExtension(config);
    ext(pi as never);

    const toolDef = getToolDef(pi);
    await toolDef.execute("c1", { pipeline: "alpha" }, undefined, vi.fn(), ctx);

    // Capture only the live updates (string[] payloads under our key).
    const liveCalls = setWidget.mock.calls.filter((c: unknown[]) => c[0] === "forgeflow-test" && Array.isArray(c[1]));
    expect(liveCalls.length).toBeGreaterThanOrEqual(2);

    const firstFrame = (liveCalls[0]?.[1] as string[]).join("\n");
    expect(firstFrame).toContain("planner");
    expect(firstFrame).toContain("0/3");

    const secondFrame = (liveCalls[1]?.[1] as string[]).join("\n");
    expect(secondFrame).toContain("implementor");
    expect(secondFrame).not.toContain("⟳ planner");
    expect(secondFrame).toContain("1/3");
  });

  it("registers commands that call sendUserMessage with the correct template", () => {
    const pi = mockPi();
    const config = minimalConfig();
    const ext = createForgeflowExtension(config);
    ext(pi as never);

    // Two user-configured commands plus the built-in /stages overlay command.
    expect(pi.registerCommand).toHaveBeenCalledTimes(3);

    // First command: "alpha-cmd" with parseArgs
    // biome-ignore lint/style/noNonNullAssertion: test accessing mock call by known index
    const [name1, opts1] = pi.registerCommand.mock.calls[0]!;
    expect(name1).toBe("alpha-cmd");
    expect(opts1.description).toBe("Run alpha");

    // Invoke the handler
    opts1.handler("42");
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", issue="42". Do not interpret.',
    );

    pi.sendUserMessage.mockClear();

    // Second command: "beta-cmd" with no parseArgs
    // biome-ignore lint/style/noNonNullAssertion: test accessing mock call by known index
    const [name2, opts2] = pi.registerCommand.mock.calls[1]!;
    expect(name2).toBe("beta-cmd");

    opts2.handler("");
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="beta".',
    );
  });

  it("renderCall returns a Text node with tool name (bold), pipeline (accent), and renderCallExtra output", () => {
    const pi = mockPi();
    const config = minimalConfig({
      renderCallExtra: (args, theme) => {
        if (args.issue) return theme.fg("dim", ` #${args.issue}`);
        return "";
      },
    });
    const ext = createForgeflowExtension(config);
    ext(pi as never);

    const toolDef = getToolDef(pi);
    const theme = mockTheme();

    const node = toolDef.renderCall({ pipeline: "alpha", issue: "42" }, theme, {});
    const lines = node.render(120);
    const text = lines.join("\n");

    expect(text).toContain("**forgeflow-test **");
    expect(text).toContain("[accent]alpha");
    expect(text).toContain("[dim] #42");
  });

  it("renderResult delegates to the shared renderResult with the correct toolName", () => {
    const pi = mockPi();
    const ext = createForgeflowExtension(minimalConfig());
    ext(pi as never);

    const toolDef = getToolDef(pi);
    const theme = mockTheme();
    const result = {
      content: [{ type: "text" as const, text: "done" }],
      details: { pipeline: "alpha", stages: [] } as PipelineDetails,
    };

    // renderResult with no stages returns a simple Text node with the content text
    const node = toolDef.renderResult(result, { expanded: false }, theme, {});
    const lines = node.render(120);
    expect(lines.join("\n")).toContain("done");
  });
});

describe("buildSendMessage", () => {
  it("formats the template correctly for different param types", () => {
    // No params
    expect(buildSendMessage("forgeflow-test", "alpha", {})).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha".',
    );

    // String param
    expect(buildSendMessage("forgeflow-test", "alpha", { issue: "42" })).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", issue="42".',
    );

    // Boolean and number params (no quotes)
    expect(buildSendMessage("forgeflow-test", "alpha", { skipPlan: true, maxIter: 5 })).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", skipPlan=true, maxIter=5.',
    );

    // With suffix
    expect(buildSendMessage("forgeflow-test", "alpha", { issue: "42" }, "Do not interpret.")).toBe(
      'Call the forgeflow-test tool now with these exact parameters: pipeline="alpha", issue="42". Do not interpret.',
    );
  });
});
