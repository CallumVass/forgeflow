import { describe, expect, it, vi } from "vitest";

vi.mock("@callumvass/forgeflow-shared/pipeline", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cleanSignal: vi.fn(),
    signalExists: vi.fn(() => false),
    readSignal: vi.fn(() => null),
  };
});

vi.mock("./review-orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: true })),
}));

import { readSignal, signalExists } from "@callumvass/forgeflow-shared/pipeline";
import { mockExecFn, mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import {
  buildImplementorPrompt,
  type PhaseContext,
  refactorAndReview,
  reviewAndFix,
  runImplementorPhase,
} from "./implement-phases.js";
import { runReviewPipeline } from "./review-orchestrator.js";

describe("buildImplementorPrompt", () => {
  it("returns correct prompt for a GitHub issue with plan, branch, and close note", () => {
    const result = buildImplementorPrompt("Issue #42: Test issue\n\nIssue body", "test plan", undefined, {
      source: "github",
      key: "42",
      number: 42,
      title: "Test issue",
      body: "Issue body",
      branch: "feat/issue-42",
    });

    expect(result).toContain("Issue #42: Test issue");
    expect(result).toContain("Issue body");
    expect(result).toContain("IMPLEMENTATION PLAN:\ntest plan");
    expect(result).toContain("You should be on branch: feat/issue-42");
    expect(result).toContain("Closes #42");
  });

  it("returns correct prompt for a Jira issue (references key, no 'Closes #N')", () => {
    const result = buildImplementorPrompt("Jira PROJ-123: Jira issue\n\nJira body", "", undefined, {
      source: "jira",
      key: "PROJ-123",
      number: 0,
      title: "Jira issue",
      body: "Jira body",
      branch: "feat/PROJ-123",
    });

    expect(result).toContain("Jira PROJ-123: Jira issue");
    expect(result).toContain("Jira body");
    expect(result).not.toContain("Closes #");
    expect(result).toContain("reference Jira issue PROJ-123");
  });

  it("includes custom prompt section and autonomous unresolved-questions note when provided", () => {
    const result = buildImplementorPrompt(
      "Issue #1: Test\n\nBody",
      "some plan",
      "Extra instructions here",
      {
        source: "github",
        key: "1",
        number: 1,
        title: "Test",
        body: "Body",
        branch: "feat/issue-1",
      },
      true, // autonomous
    );

    expect(result).toContain("ADDITIONAL INSTRUCTIONS FROM USER:\nExtra instructions here");
    expect(result).toContain("resolve them yourself using sensible defaults");
  });
});

interface PhaseSpies {
  pctx: PhaseContext;
  runAgentFn: ReturnType<typeof mockRunAgent>;
  execFn: ReturnType<typeof mockExecFn>;
}

function makePhaseContext(
  runAgentFn: ReturnType<typeof mockRunAgent> = mockRunAgent(),
  execFn: ReturnType<typeof mockExecFn> = mockExecFn(),
): PhaseSpies {
  const base = mockPipelineContext({ cwd: "/tmp", runAgentFn, execFn });
  const pctx: PhaseContext = {
    ...base,
    agentOpts: {
      agentsDir: "/agents",
      cwd: "/tmp",
      stages: [],
      pipeline: "implement",
    },
    stages: [],
  };
  return { pctx, runAgentFn, execFn };
}

describe("reviewAndFix", () => {
  it("skips review when git diff returns empty string", async () => {
    const { pctx, execFn } = makePhaseContext(mockRunAgent(), mockExecFn({ "git diff": "" }));
    vi.mocked(runReviewPipeline).mockClear();

    await reviewAndFix(pctx);

    expect(execFn).toHaveBeenCalledWith("git diff main...HEAD", "/tmp");
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });

  it("calls runReviewPipeline with diff and runs fix-findings agent when review fails", async () => {
    const { pctx, runAgentFn } = makePhaseContext(mockRunAgent(), mockExecFn({ "git diff": "some diff" }));
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: false, findings: "Some findings" });

    await reviewAndFix(pctx);

    expect(runReviewPipeline).toHaveBeenCalledWith("some diff", expect.objectContaining({ cwd: "/tmp" }));
    expect(runAgentFn).toHaveBeenCalledWith(
      "implementor",
      expect.stringContaining("Fix the following code review findings"),
      expect.objectContaining({ stageName: "fix-findings" }),
    );
  });

  it("does not invoke fix-findings agent when review passes", async () => {
    const { pctx, runAgentFn } = makePhaseContext(mockRunAgent(), mockExecFn({ "git diff": "some diff" }));
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: true });

    await reviewAndFix(pctx);

    expect(runReviewPipeline).toHaveBeenCalled();
    expect(runAgentFn).not.toHaveBeenCalled();
  });
});

describe("refactorAndReview", () => {
  it("runs refactorer agent then delegates to reviewAndFix; skips review when skipReview is true", async () => {
    const { pctx, runAgentFn } = makePhaseContext(mockRunAgent(), mockExecFn({ "git diff": "" }));
    vi.mocked(runReviewPipeline).mockClear();

    await refactorAndReview(pctx, true);

    expect(runAgentFn).toHaveBeenCalledWith("refactorer", expect.stringContaining("Refactor"), expect.any(Object));
    // skipReview=true means no review
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });
});

describe("runImplementorPhase", () => {
  it("calls pctx.runAgentFn with the prompt and returns blocked reason when blocked signal exists", async () => {
    const { pctx, runAgentFn } = makePhaseContext();
    vi.mocked(signalExists).mockReturnValueOnce(true);
    vi.mocked(readSignal).mockReturnValueOnce("blocked reason");

    const result = await runImplementorPhase(pctx, "test prompt");

    expect(runAgentFn).toHaveBeenCalledWith(
      "implementor",
      "test prompt",
      expect.not.objectContaining({ tools: expect.anything() }),
    );
    expect(result).toBe("blocked reason");
  });

  it("returns null when no blocked signal exists", async () => {
    const { pctx, runAgentFn } = makePhaseContext();
    vi.mocked(signalExists).mockReturnValueOnce(false);

    const result = await runImplementorPhase(pctx, "test prompt");

    expect(runAgentFn).toHaveBeenCalledWith("implementor", "test prompt", expect.any(Object));
    expect(result).toBeNull();
  });

  it("never passes a tools field to runAgentFn for implementor, refactorer, or fix-findings", async () => {
    const { pctx, runAgentFn } = makePhaseContext(mockRunAgent(), mockExecFn({ "git diff": "some diff" }));
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: false, findings: "Some findings" });

    await runImplementorPhase(pctx, "prompt");
    await refactorAndReview(pctx, true);
    await reviewAndFix(pctx);

    for (const call of runAgentFn.mock.calls) {
      const opts = call[2] as Record<string, unknown>;
      expect(opts).not.toHaveProperty("tools");
    }
    expect(runAgentFn).toHaveBeenCalled();
  });
});
