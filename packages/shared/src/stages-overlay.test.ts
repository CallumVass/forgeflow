import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionConfig } from "./extension.js";
import { createForgeflowExtension } from "./extension.js";
import type { PipelineDetails, StageResult } from "./pipeline.js";
import { findLatestPipelineDetails, openStagesOverlay } from "./stages-overlay.js";
import { makeStage, mockForgeflowContext, mockPi } from "./test-utils.js";

// ─── Helpers ──────────────────────────────────────────────────────────

let entryCounter = 0;

function toolResultEntry(toolName: string, details: unknown): SessionEntry {
  entryCounter += 1;
  return {
    type: "message",
    id: `e${entryCounter}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId: `tc${entryCounter}`,
      toolName,
      content: [{ type: "text", text: "ok" }],
      details,
      isError: false,
      timestamp: Date.now(),
    },
  } as unknown as SessionEntry;
}

function assistantEntry(text = "hi"): SessionEntry {
  entryCounter += 1;
  return {
    type: "message",
    id: `e${entryCounter}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  } as unknown as SessionEntry;
}

function samplePipelineDetails(overrides: Partial<PipelineDetails> = {}): PipelineDetails {
  const stages: StageResult[] = [
    makeStage({
      name: "planner",
      status: "done",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls -la" } },
            { type: "text", text: "# Plan\n\nDo the thing." },
          ],
        } as never,
      ],
      output: "# Plan\n\nDo the thing.",
      usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 2 },
      model: "claude",
    }),
    makeStage({
      name: "implementor",
      status: "running",
      messages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "t2", name: "read", arguments: { path: "src/a.ts" } }],
        } as never,
      ],
    }),
    makeStage({ name: "reviewer", status: "pending" }),
  ];
  return { pipeline: "implement", stages, ...overrides };
}

function getCommandHandler(pi: ReturnType<typeof mockPi>, name: string) {
  const call = pi.registerCommand.mock.calls.find((c: unknown[]) => c[0] === name);
  return call ? (call[1] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler : undefined;
}

function getShortcutHandler(pi: ReturnType<typeof mockPi>, key: string) {
  const call = pi.registerShortcut.mock.calls.find((c: unknown[]) => c[0] === key);
  return call ? (call[1] as { handler: (ctx: unknown) => Promise<void> }).handler : undefined;
}

function minimalConfig(overrides?: Partial<ExtensionConfig>): ExtensionConfig {
  return {
    toolName: "forgeflow-test",
    toolLabel: "Forgeflow Test",
    description: "Test extension",
    params: {},
    pipelines: [
      {
        name: "alpha",
        execute: vi.fn(async () => ({
          content: [{ type: "text" as const, text: "done" }],
          details: { pipeline: "alpha", stages: [] } as PipelineDetails,
        })),
      },
    ],
    commands: [],
    ...overrides,
  };
}

interface CustomCapture {
  factory: (
    tui: { requestRender: () => void },
    theme: { fg: (c: string, s: string) => string; bold: (s: string) => string },
    keybindings: unknown,
    done: (result: undefined) => void,
  ) => unknown;
  options: unknown;
  done: (result?: undefined) => void;
  tui: { requestRender: ReturnType<typeof vi.fn> };
  promise: Promise<undefined>;
  resolvePromise: () => void;
}

function makeCustomMock() {
  const captures: CustomCapture[] = [];
  const custom = vi.fn(async (factory: unknown, options: unknown) => {
    let resolvePromise: () => void = () => {};
    const promise = new Promise<undefined>((res) => {
      resolvePromise = () => res(undefined);
    });
    const tui = { requestRender: vi.fn() };
    const doneFn = vi.fn(() => {
      resolvePromise();
    });
    captures.push({
      factory: factory as never,
      options,
      done: doneFn,
      tui,
      promise,
      resolvePromise,
    });
    return promise;
  });
  return { custom, captures };
}

function firstCapture(captures: CustomCapture[]): CustomCapture {
  const capture = captures[0];
  if (!capture) throw new Error("expected at least one ctx.ui.custom call");
  return capture;
}

interface StagesComponent {
  render: (w: number) => string[];
  handleInput: (data: string) => void;
  dispose?: () => void;
}

function mountStagesComponent(
  capture: CustomCapture,
  theme: { fg: (c: string, s: string) => string; bold: (s: string) => string },
): StagesComponent {
  return capture.factory(capture.tui, theme, null, capture.done) as StagesComponent;
}

beforeEach(() => {
  entryCounter = 0;
});

// ─── findLatestPipelineDetails ────────────────────────────────────────

describe("findLatestPipelineDetails", () => {
  it("walks entries in reverse and returns the latest matching forgeflow tool result, ignoring non-matches and malformed entries", () => {
    const earlier = samplePipelineDetails({ pipeline: "earlier" });
    const latest = samplePipelineDetails({ pipeline: "latest" });

    const entries: SessionEntry[] = [
      assistantEntry("hello"),
      toolResultEntry("forgeflow-dev", earlier),
      toolResultEntry("other-tool", { pipeline: "nope", stages: [] }),
      assistantEntry("another"),
      toolResultEntry("forgeflow-dev", latest),
      assistantEntry("trailing"),
    ];

    const found = findLatestPipelineDetails(entries, ["forgeflow-dev", "forgeflow-pm"]);
    expect(found).toBe(latest);
    expect(found?.pipeline).toBe("latest");

    // Only looks at the specified tool names.
    const devOnly = findLatestPipelineDetails([toolResultEntry("forgeflow-pm", earlier)], ["forgeflow-dev"]);
    expect(devOnly).toBeUndefined();

    // Returns undefined when no tool result matches.
    expect(findLatestPipelineDetails([assistantEntry("x")], ["forgeflow-dev"])).toBeUndefined();

    // Returns undefined for malformed details (missing stages array).
    const malformed: SessionEntry[] = [
      toolResultEntry("forgeflow-dev", { pipeline: "broken" }),
      toolResultEntry("forgeflow-dev", { pipeline: "broken", stages: "not-array" }),
      toolResultEntry("forgeflow-dev", { stages: [] }),
    ];
    expect(findLatestPipelineDetails(malformed, ["forgeflow-dev"])).toBeUndefined();
  });
});

// ─── openStagesOverlay ────────────────────────────────────────────────

describe("openStagesOverlay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens an overlay whose initial render lists every stage with its status icon", async () => {
    const details = samplePipelineDetails();
    const entries = [toolResultEntry("forgeflow-test", details)];
    const { custom, captures } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom, notify: vi.fn() },
      sessionManager: { getBranch: () => entries },
    });

    const promise = openStagesOverlay(ctx, ["forgeflow-test"]);

    expect(custom).toHaveBeenCalledTimes(1);
    const [, options] = custom.mock.calls[0] as [
      unknown,
      { overlay: boolean; overlayOptions: Record<string, unknown> },
    ];
    expect(options.overlay).toBe(true);
    expect(options.overlayOptions.anchor).toBe("center");
    expect(options.overlayOptions.width).toBe("80%");
    expect(options.overlayOptions.maxHeight).toBe("80%");
    expect(typeof options.overlayOptions.visible).toBe("function");

    const capture = firstCapture(captures);
    const component = mountStagesComponent(capture, ctx.ui.theme);

    const joined = component.render(120).join("\n");
    expect(joined).toContain("planner");
    expect(joined).toContain("implementor");
    expect(joined).toContain("reviewer");
    // Status icons from the mock theme.
    expect(joined).toContain("[success]✓");
    expect(joined).toContain("[warning]⟳");
    expect(joined).toContain("[muted]○");
    // The in-progress stage is marked as running.
    expect(joined).toContain("(running)");

    // Clean up the overlay so the awaited promise resolves.
    component.dispose?.();
    capture.done();
    await promise;
  });

  it("selecting a stage shows its tool calls, markdown output, and usage", async () => {
    const details = samplePipelineDetails();
    const entries = [toolResultEntry("forgeflow-test", details)];
    const { custom, captures } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom },
      sessionManager: { getBranch: () => entries },
    });

    const promise = openStagesOverlay(ctx, ["forgeflow-test"]);
    const capture = firstCapture(captures);
    const component = mountStagesComponent(capture, ctx.ui.theme);

    // Render once to allow the SelectList to initialise at index 0 (planner).
    component.render(120);
    // Enter: select the currently highlighted stage.
    component.handleInput("\r");

    const detailJoined = component.render(120).join("\n");
    expect(detailJoined).toContain("planner");
    // Tool call rendered via formatToolCall.
    expect(detailJoined).toContain("ls -la");
    // Markdown final output is present.
    expect(detailJoined).toContain("Plan");
    expect(detailJoined).toContain("Do the thing.");
    // Usage line shows turns.
    expect(detailJoined).toContain("2t");

    component.dispose?.();
    capture.done();
    await promise;
  });

  it("Esc navigates from detail back to list, then Esc again closes the overlay", async () => {
    const details = samplePipelineDetails();
    const entries = [toolResultEntry("forgeflow-test", details)];
    const { custom, captures } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom },
      sessionManager: { getBranch: () => entries },
    });

    const promise = openStagesOverlay(ctx, ["forgeflow-test"]);
    const capture = firstCapture(captures);
    const component = mountStagesComponent(capture, ctx.ui.theme);

    // Enter detail view.
    component.render(120);
    component.handleInput("\r");
    expect(component.render(120).join("\n")).toContain("Do the thing.");

    // Esc → back to list view (all stage names visible again).
    component.handleInput("\x1b");
    const listAgain = component.render(120).join("\n");
    expect(listAgain).toContain("planner");
    expect(listAgain).toContain("implementor");
    expect(listAgain).toContain("reviewer");
    expect(listAgain).not.toContain("Do the thing.");

    // Esc again → close the overlay.
    expect(capture.done).not.toHaveBeenCalled();
    component.handleInput("\x1b");
    expect(capture.done).toHaveBeenCalledTimes(1);
    await promise;
  });

  it("notifies when no forgeflow pipeline exists and does not open an overlay", async () => {
    const notify = vi.fn();
    const { custom } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom, notify },
      sessionManager: { getBranch: () => [assistantEntry("nothing")] },
    });

    await openStagesOverlay(ctx, ["forgeflow-test"]);

    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No forgeflow pipeline in this session yet", "info");
  });

  it("is a no-op and notifies when ctx.hasUI is false", async () => {
    const notify = vi.fn();
    const { custom } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: false,
      ui: { custom, notify },
      sessionManager: { getBranch: () => [toolResultEntry("forgeflow-test", samplePipelineDetails())] },
    });

    await openStagesOverlay(ctx, ["forgeflow-test"]);

    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("polls session state every 250ms and re-renders when live details change; stops when disposed", async () => {
    vi.useFakeTimers();

    const details = samplePipelineDetails();
    const entries = [toolResultEntry("forgeflow-test", details)];
    const { custom, captures } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom },
      sessionManager: { getBranch: () => entries },
    });

    const promise = openStagesOverlay(ctx, ["forgeflow-test"]);
    const capture = firstCapture(captures);
    const component = mountStagesComponent(capture, ctx.ui.theme);

    // Initial render reflects seeded state.
    const first = component.render(120).join("\n");
    expect(first).toContain("⟳");

    // Mutate the seeded pipeline to simulate progress: implementor finishes, reviewer starts.
    const implementorStage = details.stages[1];
    const reviewerStage = details.stages[2];
    if (!implementorStage || !reviewerStage) throw new Error("expected 3 seeded stages");
    implementorStage.status = "done";
    reviewerStage.status = "running";

    vi.advanceTimersByTime(250);
    expect(capture.tui.requestRender).toHaveBeenCalled();

    const after = component.render(120).join("\n");
    // The reviewer is now the running stage.
    expect(after).toMatch(/\[warning\]⟳ reviewer|reviewer.*\(running\)/);

    // Dispose should clear the interval: no further requestRender calls.
    component.dispose?.();
    const callsBeforeAdvance = capture.tui.requestRender.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(capture.tui.requestRender.mock.calls.length).toBe(callsBeforeAdvance);

    capture.done();
    await promise;
  });
});

// ─── Factory wiring ───────────────────────────────────────────────────

describe("createForgeflowExtension (stages overlay wiring)", () => {
  it("registers a /stages command that opens the overlay for the configured tool name", async () => {
    const pi = mockPi();
    const ext = createForgeflowExtension(minimalConfig({ toolName: "forgeflow-test" }));
    ext(pi as never);

    const handler = getCommandHandler(pi, "stages");
    expect(handler).toBeDefined();

    const details = samplePipelineDetails();
    const entries = [toolResultEntry("forgeflow-test", details)];
    const { custom, captures } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom },
      sessionManager: { getBranch: () => entries },
    });

    if (!handler) throw new Error("expected /stages command to be registered");
    const p = handler("", ctx);
    expect(custom).toHaveBeenCalledTimes(1);

    firstCapture(captures).done();
    await p;
  });

  it("registers a Ctrl+Shift+S shortcut that opens the same overlay", async () => {
    const pi = mockPi();
    const ext = createForgeflowExtension(minimalConfig({ toolName: "forgeflow-test" }));
    ext(pi as never);

    const handler = getShortcutHandler(pi, "ctrl+shift+s");
    expect(handler).toBeDefined();

    const details = samplePipelineDetails();
    const entries = [toolResultEntry("forgeflow-test", details)];
    const { custom, captures } = makeCustomMock();
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: { custom },
      sessionManager: { getBranch: () => entries },
    });

    if (!handler) throw new Error("expected ctrl+shift+s shortcut to be registered");
    const p = handler(ctx);
    expect(custom).toHaveBeenCalledTimes(1);

    firstCapture(captures).done();
    await p;
  });
});
