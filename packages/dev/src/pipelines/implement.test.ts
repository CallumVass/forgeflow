import { describe, expect, it, vi } from "vitest";

// Mock all dependencies before importing the module under test
vi.mock("../utils/exec.js", () => ({
  exec: vi.fn(async () => ""),
}));

vi.mock("@callumvass/forgeflow-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared")>();
  return { ...actual };
});

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

vi.mock("./review.js", () => ({
  runReviewInline: vi.fn(async () => ({ content: [{ type: "text", text: "LGTM" }] })),
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

vi.mock("./agents.js", () => ({
  buildImplementorPrompt: vi.fn(() => "prompt"),
  refactorAndReview: vi.fn(async () => {}),
  reviewAndFix: vi.fn(async () => {}),
  runImplementor: vi.fn(async () => {}),
}));

import { ensurePr, mergePr, setupBranch } from "../utils/git-workflow.js";
import { runImplement } from "./implement.js";
import { runPlanning } from "./planning.js";

describe("runImplement orchestrator", () => {
  it("calls setupBranch, runPlanning, and ensurePr/mergePr in sequence", async () => {
    const ctx = { hasUI: false };
    const result = await runImplement("/tmp", "42", AbortSignal.timeout(5000), undefined, ctx, {
      skipPlan: false,
      skipReview: false,
    });

    expect(setupBranch).toHaveBeenCalledWith("/tmp", "feat/issue-42");
    expect(runPlanning).toHaveBeenCalled();
    expect(ensurePr).toHaveBeenCalled();
    expect(mergePr).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("complete");
  });
});
