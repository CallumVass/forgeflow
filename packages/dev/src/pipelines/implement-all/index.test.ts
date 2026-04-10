import { type mockExecFn, mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../git/index.js", () => ({
  findPrNumber: vi.fn(async () => 100),
  mergePr: vi.fn(async () => {}),
  returnToMain: vi.fn(async () => {}),
}));

// Stub the CI wait-and-fix loop so the existing status-bar tests do
// not block on `gh pr checks --watch`. Individual tests can override
// via `vi.mocked(waitForChecksAndFix).mockResolvedValueOnce({...})`.
vi.mock("./ci-wait.js", () => ({
  waitForChecksAndFix: vi.fn(async () => ({ passed: true, attempts: 0, failedChecks: [] })),
}));

vi.mock("../../ui/index.js", () => ({
  setForgeflowStatus: vi.fn(),
  updateProgressWidget: vi.fn(),
}));

vi.mock("../implement/index.js", () => ({
  runImplement: vi.fn(async () => ({
    content: [{ type: "text", text: "Implementation complete" }],
    isError: false,
    details: { stages: [] },
  })),
}));

import { IMPLEMENT_ALL_LABELS } from "../../issues/index.js";
import { setForgeflowStatus, updateProgressWidget } from "../../ui/index.js";
import { runImplement } from "../implement/index.js";
import { getReadyIssues, runImplementAll } from "./index.js";

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

  it("is label-agnostic: architecture depending on auto-generated and vice versa", () => {
    // Issue 50 (architecture) depends on issue 40 (auto-generated).
    // Issue 60 (auto-generated) depends on issue 55 (architecture).
    // getReadyIssues has no label input so it must treat references uniformly.
    const issues = [
      { number: 50, title: "RFC", body: "## Dependencies\n#40" },
      { number: 60, title: "Feature", body: "## Dependencies\n#55" },
    ];

    // Neither dependency satisfied yet → both held back.
    expect(getReadyIssues(issues, new Set())).toEqual([]);

    // #40 closed (auto-generated) unblocks the architecture RFC #50.
    expect(getReadyIssues(issues, new Set([40]))).toEqual([50]);

    // #55 closed (architecture) unblocks the auto-generated feature #60.
    expect(getReadyIssues(issues, new Set([55]))).toEqual([60]);

    // Both deps closed → both ready.
    expect(getReadyIssues(issues, new Set([40, 55]))).toEqual([50, 60]);
  });
});

describe("runImplementAll status bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type OpenIssue = { number: number; title: string; body: string };

  /**
   * Build an `execFn` spy whose responses depend on which `gh issue list` query
   * is being executed. The spy still appears as a plain `vi.fn()` to assertions —
   * we just install scripted side-effects via `mockImplementation`.
   */
  function setupExecMock(
    closedNumbers: number[],
    openIssues: OpenIssue[],
    opts: { openPerLabel?: Record<string, OpenIssue[]> } = {},
  ) {
    const closedOutput = closedNumbers.join("\n");
    // Track which issues the (mocked) implement call has completed so subsequent
    // open fetches drop them, naturally terminating the loop.
    const implementedNumbers = new Set<number>();
    vi.mocked(runImplement).mockImplementation(async (issueNum: string) => {
      implementedNumbers.add(Number(issueNum));
      return {
        content: [{ type: "text", text: "Implementation complete" }],
        details: { pipeline: "implement", stages: [] },
      };
    });
    const execFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("--state closed")) return closedOutput;
      if (cmd.includes("--state open")) {
        if (opts.openPerLabel) {
          for (const [label, labelled] of Object.entries(opts.openPerLabel)) {
            if (cmd.includes(`"${label}"`)) {
              return JSON.stringify(labelled.filter((i) => !implementedNumbers.has(i.number)));
            }
          }
          return "[]";
        }
        return JSON.stringify(openIssues.filter((i) => !implementedNumbers.has(i.number)));
      }
      return "";
    });
    return execFn;
  }

  function makePctx(execFn: ReturnType<typeof mockExecFn>) {
    return mockPipelineContext({
      cwd: "/tmp",
      execFn,
      ctx: mockForgeflowContext({ hasUI: true, cwd: "/tmp" }),
    });
  }

  it("shows 0/N before any issue runs when historical closed issues exist", async () => {
    const openIssues = [
      { number: 10, title: "Issue 10", body: "" },
      { number: 11, title: "Issue 11", body: "" },
    ];
    const execFn = setupExecMock([5, 6, 7], openIssues);

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

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
    // 2 historically closed + 4 open.
    const execFn = setupExecMock([1, 2], openIssues);

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

    const statusCalls = vi.mocked(setForgeflowStatus).mock.calls;
    // After completing issue 10: should show 1/4, not 3/6
    expect(statusCalls[1]?.[1]).toContain("1/4");
  });

  it("dependency resolution still uses historical closed issues", async () => {
    // Issue 20 depends on issue 10, which is historically closed
    const openIssues = [{ number: 20, title: "Issue 20", body: "## Dependencies\n#10" }];
    const execFn = setupExecMock([10], openIssues);

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

    const statusCalls = vi.mocked(setForgeflowStatus).mock.calls;
    // Issue 20 should be picked (not blocked), so we should see it in the status
    expect(statusCalls[0]?.[1]).toContain("#20");
  });

  it("queries closed issues for every label in IMPLEMENT_ALL_LABELS", async () => {
    const execFn = setupExecMock([], []);

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

    const closedCalls = execFn.mock.calls.map((c) => c[0] as string).filter((c) => c.includes("--state closed"));

    for (const label of IMPLEMENT_ALL_LABELS) {
      expect(closedCalls.some((c) => c.includes(label))).toBe(true);
    }
  });

  it("queries open issues for every label in IMPLEMENT_ALL_LABELS", async () => {
    const execFn = setupExecMock([], []);

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

    const openCalls = execFn.mock.calls.map((c) => c[0] as string).filter((c) => c.includes("--state open"));

    for (const label of IMPLEMENT_ALL_LABELS) {
      expect(openCalls.some((c) => c.includes(label))).toBe(true);
    }
  });

  it("deduplicates an issue that carries both tracked labels", async () => {
    const shared = { number: 42, title: "Dual-labelled", body: "" };
    const execFn = setupExecMock([], [], {
      openPerLabel: {
        "auto-generated": [shared],
        architecture: [shared],
      },
    });

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

    const implementCalls = vi.mocked(runImplement).mock.calls.filter((c) => c[0] === "42");
    expect(implementCalls).toHaveLength(1);

    // Progress widget should only ever know about one entry for #42.
    const lastWidgetCall = vi.mocked(updateProgressWidget).mock.calls.at(-1);
    expect(lastWidgetCall?.[1].size).toBe(1);
  });

  it("processes mixed auto-generated and architecture issues in ascending number order", async () => {
    const execFn = setupExecMock([], [], {
      openPerLabel: {
        "auto-generated": [
          { number: 10, title: "Issue 10", body: "" },
          { number: 12, title: "Issue 12", body: "" },
        ],
        architecture: [{ number: 11, title: "RFC 11", body: "" }],
      },
    });

    await runImplementAll(makePctx(execFn), { skipPlan: false, skipReview: false });

    const running = vi
      .mocked(setForgeflowStatus)
      .mock.calls.map((c) => c[1] as string)
      .filter((s) => /#\d+/.test(s))
      .map((s) => s.match(/#(\d+)/)?.[1])
      .filter((n): n is string => Boolean(n));
    // First appearance of each number captures the order they were picked.
    const firstSeen: string[] = [];
    for (const n of running) if (!firstSeen.includes(n)) firstSeen.push(n);
    expect(firstSeen).toEqual(["10", "11", "12"]);
  });
});
