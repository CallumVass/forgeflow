import type { ForgeflowContext } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext, mockRunAgent, sequencedRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { appendArchitecturalNotes } from "./plan-architecture.js";
import { resolveQuestions, runPlanning } from "./planning.js";

const TWO_CANDIDATES = [
  "### 1. Reuse shared logger",
  "The plan creates a new logger in pipeline.ts. Use the existing logger from @forgeflow/shared/logger instead.",
  "",
  "### 2. Avoid god module",
  "Adding these functions to pipeline.ts would push it past 300 lines. Extract to a dedicated module.",
].join("\n");

function mockCtx(
  opts: { editorResult?: string; selectResult?: string; inputAnswers?: (string | undefined)[] } = {},
): ForgeflowContext {
  const inputAnswers = [...(opts.inputAnswers ?? [])];
  return {
    hasUI: true,
    cwd: "/tmp/test",
    ui: {
      editor: vi.fn(async () => opts.editorResult ?? undefined),
      select: vi.fn(async () => opts.selectResult ?? undefined),
      input: vi.fn(async () => inputAnswers.shift() ?? undefined),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      theme: { fg: (_c, t) => t, bold: (t) => t },
    },
  };
}

describe("runPlanning", () => {
  it("calls planner agent and returns approved plan when user selects 'Approve and implement'", async () => {
    const ctx = mockCtx({ selectResult: "Approve and implement" });
    const runAgentFn = mockRunAgent("## Plan\n- Do thing 1\n- Do thing 2");

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(false);
    expect(result.plan).toContain("Do thing 1");
    // planner + architecture-reviewer
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("returns cancelled: true when user selects 'Cancel'", async () => {
    const ctx = mockCtx({ selectResult: "Cancel" });
    const runAgentFn = mockRunAgent("Some plan");

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(true);
  });

  it("returns cancelled: true when user dismisses the select (undefined)", async () => {
    const ctx = mockCtx({ selectResult: undefined });
    const runAgentFn = mockRunAgent("Some plan");

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(true);
  });

  it("skips interactive prompts and returns plan directly when interactive: false", async () => {
    const ctx = mockCtx();
    const runAgentFn = mockRunAgent("Auto plan");

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: false,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(false);
    expect(result.plan).toBe("Auto plan");
    expect(ctx.ui.editor).not.toHaveBeenCalled();
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("appends architectural notes when the reviewer returns candidates", async () => {
    const ctx = mockCtx({ selectResult: "Approve and implement" });
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Step 1\n- Step 2" }, // planner
      { output: TWO_CANDIDATES }, // architecture-reviewer
    ]);

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.plan).toContain("### Architectural Notes");
    expect(result.plan).toContain("Reuse shared logger");
    expect(result.plan).toContain("Avoid god module");
    // planner + architecture-reviewer
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("proceeds unchanged when reviewer returns no parseable candidates", async () => {
    const ctx = mockCtx();
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Step 1" }, // planner
      { output: "No architectural recommendations" }, // architecture-reviewer (no candidates)
    ]);

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: false,
      stages: [],
      runAgentFn,
    });

    expect(result.plan).toBe("## Plan\n- Step 1");
    expect(result.plan).not.toContain("### Architectural Notes");
    // planner + architecture-reviewer
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("shows augmented plan with architectural notes in the editor for interactive mode", async () => {
    const editorFn = vi.fn(async (_title: string, content: string) => content);
    const ctx = mockCtx({ selectResult: "Approve and implement" });
    ctx.ui.editor = editorFn;

    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Step 1" }, // planner
      { output: TWO_CANDIDATES }, // architecture-reviewer
    ]);

    await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(editorFn).toHaveBeenCalledOnce();
    const editorContent = editorFn.mock.calls[0]?.[1] as string;
    expect(editorContent).toContain("### Architectural Notes");
    expect(editorContent).toContain("Reuse shared logger");
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("in non-interactive mode augmented plan passes through without editor", async () => {
    const ctx = mockCtx();
    const runAgentFn = sequencedRunAgent([
      { output: "## Plan\n- Step 1" }, // planner
      { output: TWO_CANDIDATES }, // architecture-reviewer
    ]);

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: false,
      stages: [],
      runAgentFn,
    });

    expect(result.plan).toContain("### Architectural Notes");
    expect(ctx.ui.editor).not.toHaveBeenCalled();
    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("returns plan with error flag when planner agent fails, skipping architecture critique", async () => {
    const ctx = mockCtx();
    const runAgentFn = sequencedRunAgent([{ output: "error details", status: "failed" }]);

    const result = await runPlanning("Issue context", undefined, {
      ...mockPipelineContext({ ctx }),
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.failed).toBe(true);
    expect(result.plan).toContain("error details");
    // Only planner called — no reviewer
    expect(runAgentFn).toHaveBeenCalledTimes(1);
  });
});

describe("appendArchitecturalNotes", () => {
  it("appends formatted recommendations when non-empty; returns plan unchanged when empty", () => {
    const plan = "## Plan\n- Step 1\n- Step 2";
    const recommendations = [
      {
        label: "1. Reuse shared logger",
        body: "### 1. Reuse shared logger\nUse the existing logger from shared/utils.",
      },
      { label: "2. Avoid god module", body: "### 2. Avoid god module\nSplit pipeline.ts before it exceeds 300 lines." },
    ];

    const result = appendArchitecturalNotes(plan, recommendations);

    expect(result).toContain("### Architectural Notes");
    expect(result).toContain("Reuse shared logger");
    expect(result).toContain("Avoid god module");
    expect(result.startsWith("## Plan")).toBe(true);

    // Empty recommendations: plan unchanged
    const unchanged = appendArchitecturalNotes(plan, []);
    expect(unchanged).toBe(plan);
  });
});

describe("resolveQuestions", () => {
  it("parses unresolved questions and injects user answers", async () => {
    const plan = `## Plan
- Do stuff

### Unresolved Questions
- Should we use X or Y?
- What about Z?

### Other section
Done.`;

    const ctx = mockCtx({ inputAnswers: ["Use X", "Z is fine"] });
    const result = await resolveQuestions(plan, ctx);

    expect(result).toContain("**Answer:** Use X");
    expect(result).toContain("**Answer:** Z is fine");
    expect(result).toContain("### Other section");
  });

  it("returns plan unchanged when no Unresolved Questions section exists", async () => {
    const plan = "## Plan\n- Do stuff";
    const ctx = mockCtx();

    const result = await resolveQuestions(plan, ctx);

    expect(result).toBe(plan);
    expect(ctx.ui.input).not.toHaveBeenCalled();
  });

  it("skips questions where user enters empty answer", async () => {
    const plan = `### Unresolved Questions
- Question A?
- Question B?`;

    const ctx = mockCtx({ inputAnswers: ["", "Yes"] });
    const result = await resolveQuestions(plan, ctx);

    expect(result).not.toContain("**Answer:**  ");
    expect(result).toContain("**Answer:** Yes");
  });
});
