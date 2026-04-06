import { describe, expect, it, vi } from "vitest";

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
}));

vi.mock("./planning.js", () => ({
  runPlanning: vi.fn(async () => ({ plan: "test plan", cancelled: false, stages: [] })),
}));

vi.mock("./implement-phases.js", () => ({
  buildImplementorPrompt: vi.fn(() => "mocked prompt"),
  reviewAndFix: vi.fn(async () => {}),
  refactorAndReview: vi.fn(async () => {}),
  runImplementorPhase: vi.fn(async () => null),
}));

import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { resolveIssue } from "../utils/git.js";
import { ensurePr, mergePr, setupBranch } from "../utils/git-workflow.js";
import { runImplement } from "./implement.js";
import { buildImplementorPrompt, refactorAndReview, reviewAndFix, runImplementorPhase } from "./implement-phases.js";
import { runPlanning } from "./planning.js";

const resolvedWithExistingPR = {
  source: "github" as const,
  key: "42",
  number: 42,
  title: "Test issue",
  body: "Issue body",
  branch: "feat/issue-42",
  existingPR: 99,
};

describe("runImplement orchestrator", () => {
  it("calls setupBranch, runPlanning, buildImplementorPrompt, runImplementorPhase, refactorAndReview, and ensurePr/mergePr in sequence", async () => {
    const pctx = mockPipelineContext({ cwd: "/tmp" });
    const result = await runImplement("42", pctx, {
      skipPlan: false,
      skipReview: false,
    });

    expect(setupBranch).toHaveBeenCalledWith("/tmp", "feat/issue-42");
    expect(runPlanning).toHaveBeenCalled();
    expect(buildImplementorPrompt).toHaveBeenCalled();
    expect(runImplementorPhase).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/tmp" }), "mocked prompt");
    expect(refactorAndReview).toHaveBeenCalled();
    expect(ensurePr).toHaveBeenCalled();
    expect(mergePr).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("complete");
  });

  it("resume path (existingPR) delegates to reviewAndFix from phases module", async () => {
    vi.mocked(resolveIssue).mockResolvedValueOnce(resolvedWithExistingPR);
    vi.mocked(reviewAndFix).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(reviewAndFix).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/tmp" }));
    expect(result.content[0]?.text).toContain("Resumed");
    expect(result.content[0]?.text).toContain("PR #99");
  });

  it("resume-with-commits path calls refactorAndReview from phases module", async () => {
    vi.mocked(setupBranch).mockResolvedValueOnce({ status: "resumed" });
    vi.mocked(refactorAndReview).mockClear();

    const pctx = mockPipelineContext({ cwd: "/tmp" });
    const result = await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(refactorAndReview).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("Resumed");
  });

  it("calls ui.input in interactive mode and forwards answer to runPlanning and buildImplementorPrompt", async () => {
    const inputFn = vi.fn(async () => "check the openapi spec");
    vi.mocked(runPlanning).mockClear();
    vi.mocked(buildImplementorPrompt).mockClear();

    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: {
        hasUI: true,
        cwd: "/tmp",
        ui: {
          input: inputFn,
          editor: vi.fn(async () => undefined),
          select: vi.fn(async () => undefined),
          setStatus: vi.fn(),
          setWidget: vi.fn(),
        },
      },
    });
    await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(inputFn).toHaveBeenCalledWith("Additional instructions?", "Skip");
    expect(runPlanning).toHaveBeenCalledWith(
      expect.any(String),
      "check the openapi spec",
      expect.objectContaining({ interactive: true }),
    );
    expect(buildImplementorPrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "check the openapi spec",
      expect.any(Object),
      undefined,
    );
  });

  it("passes undefined customPrompt when user skips the interactive prompt", async () => {
    const inputFn = vi.fn(async () => "");
    vi.mocked(runPlanning).mockClear();
    vi.mocked(buildImplementorPrompt).mockClear();

    const pctx = mockPipelineContext({
      cwd: "/tmp",
      ctx: {
        hasUI: true,
        cwd: "/tmp",
        ui: {
          input: inputFn,
          editor: vi.fn(async () => undefined),
          select: vi.fn(async () => undefined),
          setStatus: vi.fn(),
          setWidget: vi.fn(),
        },
      },
    });
    await runImplement("42", pctx, { skipPlan: false, skipReview: false });

    expect(inputFn).toHaveBeenCalled();
    expect(runPlanning).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ interactive: true }),
    );
    expect(buildImplementorPrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(Object),
      undefined,
    );
  });
});
