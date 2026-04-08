import type * as fs from "node:fs";
import { mockPipelineContext, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => "# PRD"),
    writeFileSync: vi.fn(),
  };
});

vi.mock("./qa-loop.js", () => ({
  runQaLoop: vi.fn(async () => ({ accepted: true })),
}));

import { runContinue } from "./continue.js";
import { runQaLoop } from "./qa-loop.js";

describe("runContinue", () => {
  it("calls runQaLoop in Phase 2 and proceeds to issue creation on acceptance", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });
    const runAgentFn = mockRunAgent("done");
    const pctx = mockPipelineContext({ runAgentFn });

    const result = await runContinue("focus on auth", 5, pctx);

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("focus on the ## Next section"),
        pipeline: "continue",
      }),
    );
    // Phase 1 (prd-architect) and Phase 3 (gh-issue-creator) both flow through pctx.runAgentFn
    const agentCalls = runAgentFn.mock.calls.map((c) => c[0]);
    expect(agentCalls).toEqual(["prd-architect", "gh-issue-creator"]);
    // Pipeline should complete (Phase 3 runs)
    expect(result.content[0]?.text).toContain("complete");
    expect(result.isError).toBeUndefined();
  });
});
