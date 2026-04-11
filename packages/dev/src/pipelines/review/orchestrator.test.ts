import { emptyStage } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { runReviewPipeline, runStandaloneReviewPipeline } from "./orchestrator.js";

function mockRunAgent(outputs: string[] = []) {
  let callIndex = 0;
  return vi.fn(
    async (
      agent: string,
      _prompt: string,
      opts: { stageName?: string; stages: Array<{ name: string; output: string; status: string }> },
    ) => {
      const name = opts.stageName ?? agent;
      const output = outputs[callIndex] ?? "NO_FINDINGS";
      callIndex += 1;
      const stage = opts.stages.find((s) => s.name === name);
      if (stage) {
        stage.output = output;
        stage.status = "done";
      }
      return { ...emptyStage(name), output, status: "done" as const };
    },
  );
}

describe("runReviewPipeline", () => {
  const baseOpts = (runAgentFn: ReturnType<typeof mockRunAgent>) => ({
    ...mockPipelineContext({ cwd: "/tmp", agentsDir: "/tmp/agents", runAgentFn }),
    stages: [],
    pipeline: "review",
  });

  it("returns passed: true when code-reviewer reports NO_FINDINGS", async () => {
    const runAgentFn = mockRunAgent(["NO_FINDINGS"]);

    const result = await runReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toMatchObject({ passed: true });
    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(runAgentFn).toHaveBeenCalledWith(
      "code-reviewer",
      expect.stringContaining("diff content"),
      expect.any(Object),
    );
  });

  it("returns passed: true when review-judge filters all findings", async () => {
    const runAgentFn = mockRunAgent(["some findings", "NO_FINDINGS"]);

    const result = await runReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toMatchObject({ passed: true });
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(runAgentFn).toHaveBeenNthCalledWith(
      2,
      "review-judge",
      expect.stringContaining("some findings"),
      expect.any(Object),
    );
  });

  it("returns passed: false with findings when validated findings survive both stages", async () => {
    const runAgentFn = mockRunAgent(["initial findings", "validated findings"]);

    const result = await runReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toMatchObject({ passed: false, findings: "validated findings" });
    expect(runAgentFn).toHaveBeenCalledTimes(2);
  });

  it("includes custom prompt as extra instructions when provided", async () => {
    const runAgentFn = mockRunAgent(["NO_FINDINGS"]);

    await runReviewPipeline("diff content", { ...baseOpts(runAgentFn), customPrompt: "Check for SQL injection" });

    expect(runAgentFn).toHaveBeenCalledWith(
      "code-reviewer",
      expect.stringContaining("Check for SQL injection"),
      expect.any(Object),
    );
  });
});

describe("runStandaloneReviewPipeline", () => {
  const baseOpts = (runAgentFn: ReturnType<typeof mockRunAgent>) => ({
    ...mockPipelineContext({ cwd: "/tmp", agentsDir: "/tmp/agents", runAgentFn }),
    stages: [],
    pipeline: "review",
  });

  it("returns no report when blocking and advisory passes find nothing", async () => {
    const runAgentFn = mockRunAgent(["NO_FINDINGS", "NO_FINDINGS", "NO_FINDINGS"]);

    const result = await runStandaloneReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result).toEqual({
      hasBlockingFindings: false,
      blockingFindings: undefined,
      architectureFindings: undefined,
      refactorFindings: undefined,
      report: undefined,
    });
    expect(runAgentFn).toHaveBeenCalledTimes(3);
    expect(runAgentFn).toHaveBeenNthCalledWith(
      2,
      "architecture-reviewer",
      expect.stringContaining("architectural or boundary regressions"),
      expect.objectContaining({ stageName: "architecture-delta-reviewer" }),
    );
    expect(runAgentFn).toHaveBeenNthCalledWith(
      3,
      "refactor-reviewer",
      expect.stringContaining("refactor opportunities"),
      expect.objectContaining({ stageName: "refactor-reviewer" }),
    );
  });

  it("keeps validated blocking findings separate from advisory output", async () => {
    const runAgentFn = mockRunAgent(["draft finding", "validated finding", "NO_FINDINGS", "NO_FINDINGS"]);

    const result = await runStandaloneReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result.hasBlockingFindings).toBe(true);
    expect(result.blockingFindings).toBe("validated finding");
    expect(result.report).toContain("validated finding");
    expect(result.report).not.toContain("Architecture delta review");
  });

  it("includes advisory architecture and refactor findings in the standalone report", async () => {
    const runAgentFn = mockRunAgent([
      "NO_FINDINGS",
      "## Architecture delta review\n\n### 1. Split the boundary",
      "## Refactor opportunities\n\n### Opportunity 1\n- **Confidence**: 90",
    ]);

    const result = await runStandaloneReviewPipeline("diff content", baseOpts(runAgentFn));

    expect(result.hasBlockingFindings).toBe(false);
    expect(result.architectureFindings).toContain("Architecture delta review");
    expect(result.refactorFindings).toContain("Refactor opportunities");
    expect(result.report).toContain("---");
  });

  it("forwards custom instructions to the advisory passes too", async () => {
    const runAgentFn = mockRunAgent(["NO_FINDINGS", "NO_FINDINGS", "NO_FINDINGS"]);

    await runStandaloneReviewPipeline("diff content", {
      ...baseOpts(runAgentFn),
      customPrompt: "Pay special attention to auth boundaries",
    });

    expect(runAgentFn).toHaveBeenNthCalledWith(
      2,
      "architecture-reviewer",
      expect.stringContaining("Pay special attention to auth boundaries"),
      expect.any(Object),
    );
    expect(runAgentFn).toHaveBeenNthCalledWith(
      3,
      "refactor-reviewer",
      expect.stringContaining("Pay special attention to auth boundaries"),
      expect.any(Object),
    );
  });
});
