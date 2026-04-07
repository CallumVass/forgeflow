import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@callumvass/forgeflow-shared/exec", () => ({
  exec: vi.fn(async () => ""),
}));

vi.mock("../utils/git-workflow.js", () => ({
  findPrNumber: vi.fn(async () => 100),
  mergePr: vi.fn(async () => {}),
  returnToMain: vi.fn(async () => {}),
}));

vi.mock("../utils/ui.js", () => ({
  setForgeflowStatus: vi.fn(),
  updateProgressWidget: vi.fn(),
}));

vi.mock("./implement.js", () => ({
  runImplement: vi.fn(async () => ({
    content: [{ type: "text", text: "Implementation complete" }],
    isError: false,
    details: { stages: [] },
  })),
}));

import { exec } from "@callumvass/forgeflow-shared/exec";
import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { setForgeflowStatus } from "../utils/ui.js";
import { getReadyIssues, runImplementAll } from "./implement-all.js";

describe("getReadyIssues", () => {
  it("excludes issues already in the completed set", () => {
    const issues = [
      { number: 1, title: "Issue 1", body: "" },
      { number: 2, title: "Issue 2", body: "" },
    ];
    const completed = new Set([1]);

    const ready = getReadyIssues(issues, completed);

    expect(ready).toEqual([2]);
  });

  it("filters out issues with unsatisfied dependencies", () => {
    const issues = [
      { number: 2, title: "Issue 2", body: "" },
      { number: 3, title: "Issue 3", body: "## Dependencies\n#2 must be done first" },
    ];
    const completed = new Set<number>();

    const ready = getReadyIssues(issues, completed);

    expect(ready).toEqual([2]);
  });
});

describe("runImplementAll status bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupExecMock(closedNumbers: number[], openIssues: Array<{ number: number; title: string; body: string }>) {
    const closedOutput = closedNumbers.join("\n");
    const openJson = JSON.stringify(openIssues);
    let callCount = 0;
    vi.mocked(exec).mockImplementation(async (cmd: string) => {
      callCount++;
      if (cmd.includes("--state closed")) return closedOutput;
      if (cmd.includes("--state open")) {
        // After the first open call, return empty (all done) to end the loop
        if (callCount > 3) return "[]";
        return openJson;
      }
      return "";
    });
  }

  function makePctx() {
    return mockPipelineContext({
      cwd: "/tmp",
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp" }),
    });
  }

  it("shows 0/N before any issue runs when historical closed issues exist", async () => {
    const openIssues = [
      { number: 10, title: "Issue 10", body: "" },
      { number: 11, title: "Issue 11", body: "" },
    ];
    setupExecMock([5, 6, 7], openIssues);

    await runImplementAll(makePctx(), { skipPlan: false, skipReview: false });

    const statusCalls = vi.mocked(setForgeflowStatus).mock.calls;
    expect(statusCalls[0]?.[1]).toContain("0/2");
  });

  it("shows 1/N after completing the first issue, not inflated by historical closures", async () => {
    const openIssues = [
      { number: 10, title: "Issue 10", body: "" },
      { number: 11, title: "Issue 11", body: "" },
      { number: 12, title: "Issue 12", body: "" },
      { number: 13, title: "Issue 13", body: "" },
    ];
    // 2 historically closed + 4 open
    let openCallCount = 0;
    vi.mocked(exec).mockImplementation(async (cmd: string) => {
      if (cmd.includes("--state closed")) return "1\n2";
      if (cmd.includes("--state open")) {
        openCallCount++;
        // After first iteration, remove issue 10 from open list
        if (openCallCount === 1) return JSON.stringify(openIssues);
        return JSON.stringify(openIssues.slice(1));
      }
      return "";
    });

    await runImplementAll(makePctx(), { skipPlan: false, skipReview: false });

    const statusCalls = vi.mocked(setForgeflowStatus).mock.calls;
    // After completing issue 10: should show 1/4, not 3/6
    expect(statusCalls[1]?.[1]).toContain("1/4");
  });

  it("dependency resolution still uses historical closed issues", async () => {
    // Issue 20 depends on issue 10, which is historically closed
    const openIssues = [{ number: 20, title: "Issue 20", body: "## Dependencies\n#10" }];
    setupExecMock([10], openIssues);

    await runImplementAll(makePctx(), { skipPlan: false, skipReview: false });

    const statusCalls = vi.mocked(setForgeflowStatus).mock.calls;
    // Issue 20 should be picked (not blocked), so we should see it in the status
    expect(statusCalls[0]?.[1]).toContain("#20");
  });
});
