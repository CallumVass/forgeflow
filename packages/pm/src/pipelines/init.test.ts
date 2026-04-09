import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prd/document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prd/document.js")>();
  return {
    ...actual,
    prdExists: vi.fn(() => false),
  };
});

vi.mock("../prd/bootstrap.js", () => ({
  promptBootstrapPrd: vi.fn(async () => false),
}));

import { promptBootstrapPrd } from "../prd/bootstrap.js";
import { prdExists } from "../prd/document.js";
import { runInit } from "./init.js";

describe("runInit", () => {
  beforeEach(() => {
    vi.mocked(prdExists).mockReset();
    vi.mocked(prdExists).mockReturnValue(false);
    vi.mocked(promptBootstrapPrd).mockReset();
    vi.mocked(promptBootstrapPrd).mockResolvedValue(false);
  });

  it("creates an initial PRD draft when none exists", async () => {
    vi.mocked(promptBootstrapPrd).mockResolvedValue(true);

    const result = await runInit(
      mockPipelineContext({
        ctx: mockForgeflowContext({ hasUI: true }),
      }),
    );

    expect(promptBootstrapPrd).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain("Initial PRD draft created");
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
