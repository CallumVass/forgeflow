import { describe, expect, it, vi } from "vitest";

// Mock all dependencies — after inlining, we mock the real deps instead of ./agents.js
vi.mock("@callumvass/forgeflow-shared/agent", () => ({
  runAgent: vi.fn(async () => ({ output: "", status: "done" })),
}));

vi.mock("@callumvass/forgeflow-shared/exec", () => ({
  exec: vi.fn(async () => "diff content"),
}));

vi.mock("../utils/git.js", () => ({
  buildPrBody: vi.fn(() => "PR body"),
  resolveIssue: vi.fn(async () => ({
    source: "github",
    key: "42",
    number: 42,
    title: "Test issue",
    body: "Issue body",
    branch: "feat/issue-42",
  })),
}));

vi.mock("../utils/ui.js", () => ({
  setForgeflowStatus: vi.fn(),
}));

vi.mock("../utils/git-workflow.js", () => ({
  setupBranch: vi.fn(async () => ({ status: "fresh" })),
  ensurePr: vi.fn(async () => ({ number: 10, created: true })),
  mergePr: vi.fn(async () => {}),
  returnToMain: vi.fn(async () => {}),
  verifyOnBranch: vi.fn(async () => {}),
}));

vi.mock("./planning.js", () => ({
  runPlanning: vi.fn(async () => ({ plan: "test plan", cancelled: false, stages: [] })),
}));

vi.mock("./review-orchestrator.js", () => ({
  runReviewPipeline: vi.fn(async () => ({ passed: true })),
}));

import { runAgent } from "@callumvass/forgeflow-shared/agent";
import { exec } from "@callumvass/forgeflow-shared/exec";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { resolveIssue } from "../utils/git.js";
import { ensurePr, mergePr, setupBranch } from "../utils/git-workflow.js";
import { runImplement } from "./implement.js";
import { runPlanning } from "./planning.js";
import { runReviewPipeline } from "./review-orchestrator.js";

describe("runImplement orchestrator", () => {
  it("calls setupBranch, runPlanning, runAgent (implementor), and ensurePr/mergePr in sequence", async () => {
    const pctx = mockPipelineContext({ cwd: "/tmp" });
    const result = await runImplement("42", pctx, {
      skipPlan: false,
      skipReview: false,
    });

    expect(setupBranch).toHaveBeenCalledWith("/tmp", "feat/issue-42");
    expect(runPlanning).toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledWith(
      "implementor",
      expect.any(String),
      expect.objectContaining({ tools: expect.any(Array) }),
    );
    expect(ensurePr).toHaveBeenCalled();
    expect(mergePr).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("complete");
  });

  it("resume path (existingPR) calls reviewAndFix via exec + runReviewPipeline", async () => {
    vi.mocked(resolveIssue).mockResolvedValueOnce({
      source: "github",
      key: "42",
      number: 42,
      title: "Test issue",
      body: "Issue body",
      branch: "feat/issue-42",
      existingPR: 99,
    });
    vi.mocked(runAgent).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(exec).toHaveBeenCalledWith("git diff main...HEAD", "/tmp");
    expect(runReviewPipeline).toHaveBeenCalledWith("diff content", expect.objectContaining({ cwd: "/tmp" }));
    expect(result.content[0]?.text).toContain("Resumed");
    expect(result.content[0]?.text).toContain("PR #99");
  });

  it("resume-with-commits path calls refactorer agent then review pipeline", async () => {
    vi.mocked(setupBranch).mockResolvedValueOnce({ status: "resumed" });
    vi.mocked(runAgent).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    // Should call refactorer then review
    expect(runAgent).toHaveBeenCalledWith("refactorer", expect.stringContaining("Refactor"), expect.any(Object));
    expect(runReviewPipeline).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("Resumed");
  });

  it("reviewAndFix skips review when diff is empty", async () => {
    vi.mocked(resolveIssue).mockResolvedValueOnce({
      source: "github",
      key: "42",
      number: 42,
      title: "Test issue",
      body: "Issue body",
      branch: "feat/issue-42",
      existingPR: 99,
    });
    vi.mocked(exec).mockResolvedValueOnce("");
    vi.mocked(runReviewPipeline).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(runReviewPipeline).not.toHaveBeenCalled();
  });

  it("reviewAndFix runs fix-findings agent when review fails", async () => {
    vi.mocked(resolveIssue).mockResolvedValueOnce({
      source: "github",
      key: "42",
      number: 42,
      title: "Test issue",
      body: "Issue body",
      branch: "feat/issue-42",
      existingPR: 99,
    });
    vi.mocked(runReviewPipeline).mockResolvedValueOnce({ passed: false, findings: "Some findings" });
    vi.mocked(runAgent).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(runAgent).toHaveBeenCalledWith(
      "implementor",
      expect.stringContaining("Fix the following code review findings"),
      expect.objectContaining({ stageName: "fix-findings" }),
    );
  });
});

describe("buildImplementorPrompt", () => {
  // We need to test the prompt builder — import it if exported, or test via runImplement's output
  // Since it's now private, we test it indirectly via the prompt passed to runAgent

  it("produces correct prompt with GitHub issue context, plan, branch note, and close note", async () => {
    vi.mocked(runAgent).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    await runImplement("42", pctx, { skipPlan: false, skipReview: true });

    const implementorCall = vi.mocked(runAgent).mock.calls.find(([name]) => name === "implementor");
    expect(implementorCall).toBeDefined();
    const prompt = implementorCall![1] as string;

    expect(prompt).toContain("Issue #42: Test issue");
    expect(prompt).toContain("Issue body");
    expect(prompt).toContain("IMPLEMENTATION PLAN:\ntest plan");
    expect(prompt).toContain("You should be on branch: feat/issue-42");
    expect(prompt).toContain("Closes #42");
  });

  it("produces correct prompt for Jira issue (references key, no 'Closes #N')", async () => {
    vi.mocked(resolveIssue).mockResolvedValueOnce({
      source: "jira",
      key: "PROJ-123",
      number: 0,
      title: "Jira issue",
      body: "Jira body",
      branch: "feat/PROJ-123",
    });
    vi.mocked(runAgent).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    await runImplement("PROJ-123", pctx, { skipPlan: true, skipReview: true });

    const implementorCall = vi.mocked(runAgent).mock.calls.find(([name]) => name === "implementor");
    expect(implementorCall).toBeDefined();
    const prompt = implementorCall![1] as string;

    expect(prompt).toContain("Jira PROJ-123: Jira issue");
    expect(prompt).toContain("Jira body");
    expect(prompt).not.toContain("Closes #");
    expect(prompt).toContain("reference Jira issue PROJ-123");
  });
});
