import type { ForgeflowContext } from "@callumvass/forgeflow-shared";
import { describe, expect, it, vi } from "vitest";
import { resolveQuestions, runPlanning } from "./planning.js";

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
    },
  };
}

function mockRunAgent(output = "The plan", status: "done" | "failed" = "done") {
  return vi.fn(async () => ({ output, status }));
}

describe("runPlanning", () => {
  it("calls planner agent and returns approved plan when user selects 'Approve and implement'", async () => {
    const ctx = mockCtx({ selectResult: "Approve and implement" });
    const runAgentFn = mockRunAgent("## Plan\n- Do thing 1\n- Do thing 2");

    const result = await runPlanning("/tmp", "Issue context", undefined, {
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx,
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(false);
    expect(result.plan).toContain("Do thing 1");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("returns cancelled: true when user selects 'Cancel'", async () => {
    const ctx = mockCtx({ selectResult: "Cancel" });
    const runAgentFn = mockRunAgent("Some plan");

    const result = await runPlanning("/tmp", "Issue context", undefined, {
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx,
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(true);
  });

  it("returns cancelled: true when user dismisses the select (undefined)", async () => {
    const ctx = mockCtx({ selectResult: undefined });
    const runAgentFn = mockRunAgent("Some plan");

    const result = await runPlanning("/tmp", "Issue context", undefined, {
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx,
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(true);
  });

  it("skips interactive prompts and returns plan directly when interactive: false", async () => {
    const ctx = mockCtx();
    const runAgentFn = mockRunAgent("Auto plan");

    const result = await runPlanning("/tmp", "Issue context", undefined, {
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx,
      interactive: false,
      stages: [],
      runAgentFn,
    });

    expect(result.cancelled).toBe(false);
    expect(result.plan).toBe("Auto plan");
    expect(ctx.ui.editor).not.toHaveBeenCalled();
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("returns plan with error flag when planner agent fails", async () => {
    const ctx = mockCtx();
    const runAgentFn = mockRunAgent("error details", "failed");

    const result = await runPlanning("/tmp", "Issue context", undefined, {
      signal: AbortSignal.timeout(5000),
      onUpdate: undefined,
      ctx,
      interactive: true,
      stages: [],
      runAgentFn,
    });

    expect(result.failed).toBe(true);
    expect(result.plan).toContain("error details");
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
