import { mockForgeflowContext, mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prd/index.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => false),
    promptBootstrapPrd: vi.fn(async () => false),
  };
});

import { prdExists, promptBootstrapPrd } from "../prd/index.js";
import { runInit } from "./init.js";

function execSafeFnForCreatedIssue(body: string, issueNumber = 101) {
  let listCalls = 0;
  return vi.fn(async (cmd: string) => {
    if (cmd.includes("gh issue list")) {
      listCalls += 1;
      return JSON.stringify(listCalls === 1 ? [] : [{ number: issueNumber }]);
    }
    if (cmd.includes(`gh issue view ${issueNumber}`)) {
      return JSON.stringify({ number: issueNumber, title: "Bootstrap issue", body });
    }
    return "";
  });
}

const VALID_ISSUE_BODY = `## Context
A thin bootstrap slice.

## Acceptance Criteria
- [ ] User sees the chosen starter boot successfully.

## Test Plan
- [ ] Trigger: GET / returns the starter shell.
- [ ] Boundary: the chosen starter and baseline styling load without fallback styling.

## Implementation Hints
Keep the route wiring small.

## Structural Placement
- Owning boundary: \`src/app-shell/\`
- Public entry point: \`src/app-shell/index.js\`
- Files in scope: \`src/app-shell/index.js\`, \`test/app-shell/app-shell.spec.js\`
- Out of scope: new unrelated files directly under \`src/\` or \`test/\`

## TDD Rehearsal
Planned red-green cycles:
1. Starter shell renders → \`test/app-shell/app-shell.spec.js\`

Totals:
- Tests: 1 / 15
- Files touched (estimate): 2 / 10
- Integration sites: 1 / 1

## Dependencies
None.
`;

describe("runInit", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReset();
    vi.mocked(prdExists).mockReturnValue(false);
    vi.mocked(promptBootstrapPrd).mockReset();
    vi.mocked(promptBootstrapPrd).mockResolvedValue(false);
  });

  it("creates an initial PRD draft when none exists and skips bootstrap issue creation", async () => {
    vi.mocked(promptBootstrapPrd).mockResolvedValue(true);

    const result = await runInit(
      mockPipelineContext({
        ctx: mockForgeflowContext({ hasUI: true, ui: { select: vi.fn(async () => "Skip for now") } }),
      }),
    );

    expect(promptBootstrapPrd).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain("bootstrap constraints created");
    expect(result.content[0]?.text).toContain(".forgeflow/BOOTSTRAP.md");
    expect(result.isError).toBeUndefined();
  });

  it("returns a helpful message when PRD.md already exists", async () => {
    vi.mocked(prdExists).mockReturnValue(true);

    const result = await runInit(mockPipelineContext());

    expect(promptBootstrapPrd).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("PRD.md already exists");
  });

  it("returns a non-interactive guidance message when no UI is available", async () => {
    const result = await runInit(
      mockPipelineContext({
        ctx: mockForgeflowContext({ hasUI: false }),
      }),
    );

    expect(promptBootstrapPrd).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("interactive mode");
  });

  it("can create an initial bootstrap issue after writing the PRD and constraints", async () => {
    vi.mocked(promptBootstrapPrd).mockResolvedValue(true);
    const runAgentFn = mockRunAgent("done");
    const execSafeFn = execSafeFnForCreatedIssue(VALID_ISSUE_BODY, 123);

    const result = await runInit(
      mockPipelineContext({
        runAgentFn,
        execSafeFn,
        ctx: mockForgeflowContext({ hasUI: true, ui: { select: vi.fn(async () => "Create bootstrap issue") } }),
      }),
    );

    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(runAgentFn.mock.calls[0]?.[0]).toBe("gh-single-issue-creator");
    expect(runAgentFn.mock.calls[0]?.[1]).toContain(".forgeflow/BOOTSTRAP.md");
    expect(result.content[0]?.text).toContain("/implement #123");
    expect(result.content[0]?.text).toContain("/continue");
    expect(result.isError).toBeUndefined();
  });

  it("returns a cancellation message when the bootstrap flow is dismissed", async () => {
    vi.mocked(promptBootstrapPrd).mockResolvedValue(false);

    const result = await runInit(
      mockPipelineContext({
        ctx: mockForgeflowContext({ hasUI: true }),
      }),
    );

    expect(promptBootstrapPrd).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain("cancelled");
  });
});
