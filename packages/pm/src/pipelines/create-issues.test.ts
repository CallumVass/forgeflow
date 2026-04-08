import { mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd-document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prd-document.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => true),
  };
});

import { prdExists } from "../prd-document.js";
import { runCreateIssues } from "./create-issues.js";

describe("runCreateIssues", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReturnValue(true);
  });

  it("invokes gh-issue-creator once when PRD exists", async () => {
    const runAgentFn = mockRunAgent("done");
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runCreateIssues(pctx);

    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(runAgentFn.mock.calls[0]?.[0]).toBe("gh-issue-creator");
    expect(result.content[0]?.text).toContain("Issue creation complete.");
    expect(result.isError).toBeUndefined();
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
