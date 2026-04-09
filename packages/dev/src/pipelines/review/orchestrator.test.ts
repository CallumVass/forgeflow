import { emptyStage } from "@callumvass/forgeflow-shared/pipeline";
import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { runReviewPipeline } from "./orchestrator.js";

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

    expect(result).toEqual({ passed: true });
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

    expect(result).toEqual({ passed: true });
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

    expect(result).toEqual({ passed: false, findings: "validated findings" });
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
