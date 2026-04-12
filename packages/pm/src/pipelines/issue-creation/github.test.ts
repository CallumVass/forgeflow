import { mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prd/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../prd/index.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => true),
  };
});

import { prdExists } from "../../prd/index.js";
import { runCreateIssue, runCreateIssues } from "./github.js";

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

describe("runCreateIssues", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReturnValue(true);
  });

  it("invokes gh-issue-creator once when PRD exists", async () => {
    const runAgentFn = mockRunAgent("done");
    const execSafeFn = execSafeFnForCreatedIssue(VALID_ISSUE_BODY);
    const pctx = mockPipelineContext({ runAgentFn, execSafeFn });

    const result = await runCreateIssues(pctx);

    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(runAgentFn.mock.calls[0]?.[0]).toBe("gh-issue-creator");
    expect(result.content[0]?.text).toContain("Issue creation complete.");
    expect(result.isError).toBeUndefined();
  });

  it("fails when created issues miss structural placement requirements", async () => {
    const runAgentFn = mockRunAgent("done");
    const execSafeFn = execSafeFnForCreatedIssue(
      `## Context\nMissing structure.\n\n## Test Plan\n- [ ] Trigger: GET /inventory returns the inventory screen.\n\n## TDD Rehearsal\nPlanned red-green cycles:\n1. One thing → \`test.spec\`\n\nTotals:\n- Tests: 1 / 15\n- Files touched (estimate): 1 / 10\n- Integration sites: 1 / 1\n`,
    );
    const pctx = mockPipelineContext({ runAgentFn, execSafeFn });

    const result = await runCreateIssues(pctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Issue creation failed validation");
    expect(result.content[0]?.text).toContain("missing `## Structural Placement` section");
  });

  it("returns a PRD.md not found result and runs no agents when PRD is missing", async () => {
    vi.mocked(prdExists).mockReturnValue(false);
    const runAgentFn = mockRunAgent("should not be called");
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runCreateIssues(pctx);

    expect(result.content[0]?.text).toContain("PRD.md not found.");
    expect(runAgentFn).not.toHaveBeenCalled();
  });
});

describe("runCreateIssue", () => {
  it("fails when the created single issue uses a generic root as its boundary", async () => {
    const runAgentFn = mockRunAgent("done");
    const execSafeFn = execSafeFnForCreatedIssue(
      VALID_ISSUE_BODY.replace("`src/inventory/`", "`src/`").replace("`src/inventory/index.js`", "`src/app.js`"),
      202,
    );
    const pctx = mockPipelineContext({ runAgentFn, execSafeFn });

    const result = await runCreateIssue("Add inventory home", pctx);

    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(runAgentFn.mock.calls[0]?.[0]).toBe("gh-single-issue-creator");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("ends at generic root `src/`");
  });
});
