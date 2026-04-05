import type * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

vi.mock("./qa-loop.js", () => ({
  runQaLoop: vi.fn(async () => ({ accepted: true })),
}));

import { runPrdQa } from "./prd-qa.js";
import { runQaLoop } from "./qa-loop.js";

describe("runPrdQa", () => {
  it("delegates to runQaLoop and returns success when accepted", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: true });

    const result = await runPrdQa("/tmp/test", 10, AbortSignal.timeout(5000), undefined, { hasUI: false });

    expect(mockedRunQaLoop).toHaveBeenCalledOnce();
    expect(mockedRunQaLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        criticPrompt: expect.stringContaining("Review PRD.md for completeness"),
        pipeline: "prd-qa",
        maxIterations: 10,
      }),
    );
    expect(result.content[0]?.text).toContain("refinement complete");
    expect(result.isError).toBeUndefined();
  });

  it("returns error result when runQaLoop returns an error", async () => {
    const mockedRunQaLoop = vi.mocked(runQaLoop);
    mockedRunQaLoop.mockResolvedValue({ accepted: false, error: { text: "Critic failed." } });

    const result = await runPrdQa("/tmp/test", 10, AbortSignal.timeout(5000), undefined, { hasUI: false });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Critic failed.");
  });
});
