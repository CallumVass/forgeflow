import type * as fs from "node:fs";
import { mockForgeflowContext } from "@callumvass/forgeflow-shared";
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

// Mock runAgent and emptyStage for Phase 1 and Phase 3
vi.mock("@callumvass/forgeflow-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared")>();
  return {
    ...actual,
    runAgent: vi.fn(async () => ({ output: "done", status: "done", stderr: "" })),
  };
});

import { runContinue } from "./continue.js";
import { runQaLoop } from "./qa-loop.js";

describe("runContinue", () => {
  it("calls runQaLoop in Phase 2 and proceeds to issue creation on acceptance", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });
    const ctx = mockForgeflowContext();

    const result = await runContinue("/tmp/test", "focus on auth", 5, AbortSignal.timeout(5000), undefined, ctx);

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("focus on the ## Next section"),
        pipeline: "continue",
      }),
    );
    // Pipeline should complete (Phase 3 runs)
    expect(result.content[0]?.text).toContain("complete");
    expect(result.isError).toBeUndefined();
  });
});
