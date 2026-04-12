import { mockForgeflowContext, mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prd/index.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => true),
    runQaLoop: vi.fn(async () => ({ accepted: true })),
  };
});

import { prdExists, runQaLoop } from "../prd/index.js";
import { runContinue } from "./continue.js";

const VALID_ISSUE_BODY = `## Context
A small slice.

## Acceptance Criteria
- [ ] User sees the flow.

## Test Plan
- [ ] Trigger: GET /inventory returns the inventory screen.
- [ ] Boundary: invalid input shows an inline message.

## Implementation Hints
Keep the route wiring small.

## Structural Placement
- Owning boundary: \`src/inventory/\`
- Public entry point: \`src/inventory/index.js\`
- Files in scope: \`src/inventory/index.js\`, \`test/inventory/inventory.spec.js\`
- Out of scope: new unrelated files directly under \`src/\` or \`test/\`

## TDD Rehearsal
Planned red-green cycles:
1. Inventory route renders screen → \`test/inventory/inventory.spec.js\`

Totals:
- Tests: 1 / 15
- Files touched (estimate): 2 / 10
- Integration sites: 1 / 1

## Dependencies
None.
`;

function execSafeFnForCreatedIssue(body: string, issueNumber = 101) {
  let listCalls = 0;
  return vi.fn(async (cmd: string) => {
    if (cmd.includes("gh issue list")) {
      listCalls += 1;
      return JSON.stringify(listCalls === 1 ? [] : [{ number: issueNumber }]);
    }
    if (cmd.includes(`gh issue view ${issueNumber}`)) {
      return JSON.stringify({ number: issueNumber, title: "Generated issue", body });
    }
    return "";
  });
}

describe("runContinue", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReturnValue(true);
    vi.mocked(runQaLoop).mockClear();
    vi.mocked(runQaLoop).mockResolvedValue({ accepted: true });
  });

  it("calls runQaLoop in Phase 2 and proceeds to issue creation on acceptance", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });
    const runAgentFn = mockRunAgent("done");
    const execSafeFn = execSafeFnForCreatedIssue(VALID_ISSUE_BODY);
    const pctx = mockPipelineContext({ runAgentFn, execSafeFn });

    const result = await runContinue("focus on auth", 5, pctx);

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("focus on the ## Next section"),
        pipeline: "continue",
        uiReviewMode: "final",
        finalReviewTitle: "PRD refinement complete — Review updated PRD (Done/Next structure)",
      }),
    );
    // Phase 1 (prd-architect) and Phase 3 (gh-issue-creator) both flow through pctx.runAgentFn
    const agentCalls = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agentCalls).toEqual(["prd-architect", "gh-issue-creator"]);
    // Pipeline should complete (Phase 3 runs)
    expect(result.content[0]?.text).toContain("complete");
    expect(result.isError).toBeUndefined();
  });

  it("returns a PRD.md not found result and runs no agents when PRD is missing", async () => {
    vi.mocked(prdExists).mockReturnValue(false);
    const runAgentFn = mockRunAgent("should not be called");
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runContinue("anything", 5, pctx);

    expect(result.content[0]?.text).toContain("PRD.md not found.");
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(vi.mocked(runQaLoop)).not.toHaveBeenCalled();
  });

  it("asks once at the end whether to create issues when ctx.hasUI is true", async () => {
    vi.mocked(runQaLoop).mockResolvedValue({ accepted: true });
    const select = vi.fn(async () => "Create issues");
    const ctx = mockForgeflowContext({ hasUI: true, ui: { select } });
    const runAgentFn = mockRunAgent("done");
    const execSafeFn = execSafeFnForCreatedIssue(VALID_ISSUE_BODY);
    const pctx = mockPipelineContext({ runAgentFn, ctx, execSafeFn });

    await runContinue("focus", 5, pctx);

    expect(select).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith("PRD refinement complete. What next?", ["Create issues", "Stop here"]);
  });
});
