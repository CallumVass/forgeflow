import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exploreLambdaWithAgent: vi.fn(),
  runDatadogInvestigation: vi.fn(),
}));

vi.mock("./explorer.js", () => ({
  exploreLambdaWithAgent: mocks.exploreLambdaWithAgent,
}));

vi.mock("./investigation/index.js", () => ({
  runDatadogInvestigation: mocks.runDatadogInvestigation,
}));

import { runDatadog } from "./index.js";

describe("runDatadog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("collects a prompt, resolves the Lambda, and delegates to the investigation boundary", async () => {
    mocks.exploreLambdaWithAgent.mockResolvedValue({
      selected: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ProfileFetch",
        score: 1,
        reasons: [],
      },
      candidates: [],
      ambiguous: false,
    });
    mocks.runDatadogInvestigation.mockResolvedValue("Investigation report");

    const pctx = mockPipelineContext({
      ctx: {
        hasUI: true,
        cwd: "/tmp/project",
        ui: {
          input: vi.fn(async () => "investigate the profile fetch lambda in prod"),
          editor: async () => undefined,
          select: async () => undefined,
          setStatus: () => {},
          setWidget: () => {},
          notify: () => {},
          custom: async () => undefined as never,
          theme: {
            fg: (_category: string, text: string) => text,
            bold: (text: string) => text,
          },
        },
        sessionManager: { getBranch: () => [] },
      },
    });

    const result = await runDatadog("", pctx);

    expect(mocks.runDatadogInvestigation).toHaveBeenCalledWith({
      prompt: "investigate the profile fetch lambda in prod",
      request: {
        originalPrompt: "investigate the profile fetch lambda in prod",
        intent: "investigate",
        env: "prod",
        windowMs: 24 * 60 * 60 * 1000,
      },
      candidate: {
        file: "infra/lambda.ts",
        line: 42,
        constructId: "ProfileFetch",
        score: 1,
        reasons: [],
      },
      pctx: expect.objectContaining({ cwd: "/tmp/test" }),
    });
    expect(result.content[0]?.text).toBe("Investigation report");
  });

  it("returns the existing prompt and lambda guard messages without delegating", async () => {
    const noPrompt = await runDatadog("", mockPipelineContext());
    expect(noPrompt.content[0]?.text).toBe("No Datadog prompt provided.");

    mocks.exploreLambdaWithAgent.mockResolvedValueOnce({
      selected: undefined,
      ambiguous: true,
      candidates: [
        { file: "infra/one.ts", line: 1, constructId: "ProfileFetch", score: 1, reasons: [] },
        { file: "infra/two.ts", line: 2, constructId: "ProfileFetchReplica", score: 1, reasons: [] },
      ],
    });
    const ambiguous = await runDatadog("investigate profile", mockPipelineContext());
    expect(ambiguous.content[0]?.text).toContain("I found multiple plausible Lambda candidates.");

    mocks.exploreLambdaWithAgent.mockResolvedValueOnce({
      selected: undefined,
      ambiguous: false,
      candidates: [],
    });
    const noSelection = await runDatadog("investigate profile", mockPipelineContext());
    expect(noSelection.content[0]?.text).toBe("No Lambda candidate was selected for the Datadog investigation.");

    expect(mocks.runDatadogInvestigation).not.toHaveBeenCalled();
  });
});
