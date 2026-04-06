import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// We'll need these mocks for reviewAndFix and refactorAndReview tests later
vi.mock("@callumvass/forgeflow-shared/agent", () => ({
  runAgent: vi.fn(async () => ({ output: "", status: "done" })),
}));

vi.mock("@callumvass/forgeflow-shared/exec", () => ({
  exec: vi.fn(async () => "diff content"),
}));

vi.mock("@callumvass/forgeflow-shared/signals", () => ({
  cleanSignal: vi.fn(),
  signalExists: vi.fn(() => false),
  readSignal: vi.fn(() => null),
}));

vi.mock("./review-orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: true })),
}));

import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { exec } from "@callumvass/forgeflow-shared/exec";
import { readSignal, signalExists } from "@callumvass/forgeflow-shared/signals";
import type { RunAgentOpts } from "@callumvass/forgeflow-shared/types";
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

function makePhaseContext(overrides?: Partial<PhaseContext>): PhaseContext {
  return {
    cwd: "/tmp",
    agentOpts: {
      agentsDir: "/agents",
      cwd: "/tmp",
      stages: [],
      pipeline: "implement",
    } satisfies RunAgentOpts,
    stages: [],
    ...overrides,
  };
}

describe("reviewAndFix", () => {
  it("skips review when git diff returns empty string", async () => {
    vi.mocked(exec).mockResolvedValueOnce("");
    vi.mocked(runReviewPipeline).mockClear();

    const pctx = makePhaseContext();
    await reviewAndFix(pctx);

    expect(runReviewPipeline).not.toHaveBeenCalled();
  });

  it("calls runReviewPipeline with diff and runs fix-findings agent when review fails", async () => {
    vi.mocked(exec).mockResolvedValueOnce("some diff");
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: false, findings: "Some findings" });
    vi.mocked(runAgent).mockClear();

    const pctx = makePhaseContext();
    await reviewAndFix(pctx);

    expect(runReviewPipeline).toHaveBeenCalledWith("some diff", expect.objectContaining({ cwd: "/tmp" }));
    expect(runAgent).toHaveBeenCalledWith(
      "implementor",
      expect.stringContaining("Fix the following code review findings"),
      expect.objectContaining({ stageName: "fix-findings" }),
    );
  });

  it("does not invoke fix-findings agent when review passes", async () => {
    vi.mocked(exec).mockResolvedValueOnce("some diff");
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: true });
    vi.mocked(runAgent).mockClear();

    const pctx = makePhaseContext();
    await reviewAndFix(pctx);

    expect(runReviewPipeline).toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });
});

describe("refactorAndReview", () => {
  it("runs refactorer agent then delegates to reviewAndFix; skips review when skipReview is true", async () => {
    vi.mocked(exec).mockResolvedValue("");
    vi.mocked(runAgent).mockClear();
    vi.mocked(runReviewPipeline).mockClear();

    const pctx = makePhaseContext();
    await refactorAndReview(pctx, true);

    expect(runAgent).toHaveBeenCalledWith("refactorer", expect.stringContaining("Refactor"), expect.any(Object));
    // skipReview=true means no review
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });
});

describe("runImplementorPhase", () => {
  it("calls runAgent with the prompt and returns blocked reason when blocked signal exists", async () => {
    vi.mocked(signalExists).mockReturnValueOnce(true);
    vi.mocked(readSignal).mockReturnValueOnce("blocked reason");
    vi.mocked(runAgent).mockClear();

    const pctx = makePhaseContext();
    const result = await runImplementorPhase(pctx, "test prompt");

    expect(runAgent).toHaveBeenCalledWith(
      "implementor",
      "test prompt",
      expect.objectContaining({ tools: expect.any(Array) }),
    );
    expect(result).toBe("blocked reason");
  });

  it("returns null when no blocked signal exists", async () => {
    vi.mocked(signalExists).mockReturnValueOnce(false);
    vi.mocked(runAgent).mockClear();

    const pctx = makePhaseContext();
    const result = await runImplementorPhase(pctx, "test prompt");

    expect(runAgent).toHaveBeenCalledWith("implementor", "test prompt", expect.any(Object));
    expect(result).toBeNull();
  });
});

describe("structural assertions", () => {
  it("implement.ts has no direct imports from agent, exec, or signals; implement-phases.ts exports all extracted functions", () => {
    const implementSrc = readFileSync(resolve(__dirname, "implement.ts"), "utf-8");

    // implement.ts should not import these modules directly (they moved to implement-phases.ts)
    expect(implementSrc).not.toContain('from "@callumvass/forgeflow-shared/agent"');
    expect(implementSrc).not.toContain('from "@callumvass/forgeflow-shared/exec"');
    expect(implementSrc).not.toContain('from "@callumvass/forgeflow-shared/signals"');

    // implement.ts should not define these functions
    expect(implementSrc).not.toContain("function buildImplementorPrompt");
    expect(implementSrc).not.toContain("function reviewAndFix");
    expect(implementSrc).not.toContain("function refactorAndReview");

    // implement-phases.ts should export the extracted functions and PhaseContext
    const phasesSrc = readFileSync(resolve(__dirname, "implement-phases.ts"), "utf-8");
    expect(phasesSrc).toContain("export function buildImplementorPrompt");
    expect(phasesSrc).toContain("export async function reviewAndFix");
    expect(phasesSrc).toContain("export async function refactorAndReview");
    expect(phasesSrc).toContain("export interface PhaseContext");
  });

  it("implement.test.ts has at most 5 vi.mock() declarations", () => {
    const testSrc = readFileSync(resolve(__dirname, "implement.test.ts"), "utf-8");
    const mockCount = (testSrc.match(/vi\.mock\(/g) || []).length;
    expect(mockCount).toBeLessThanOrEqual(5);
  });
});
