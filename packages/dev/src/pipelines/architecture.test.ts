import { mockForgeflowContext, mockPipelineContext, sequencedRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { parseCandidates, parseJudgeVerdict, runArchitecture } from "./architecture.js";

const THREE_CANDIDATES = [
  "### 1. High coupling in auth module",
  "Auth is tightly coupled to the database layer.",
  "",
  "### 2. Missing error boundaries",
  "No error boundaries in the React tree.",
  "",
  "### 3. Circular dependency in utils",
  "Utils imports from core which imports from utils.",
].join("\n");

describe("runArchitecture", () => {
  it("filters out candidates rejected by the judge in non-interactive mode", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES }, // architecture-reviewer
      { output: "VERDICT: KEEP\nEvidence checks out." }, // judge candidate 1
      { output: "VERDICT: REJECT\nFile does not exist." }, // judge candidate 2
      { output: "VERDICT: KEEP\nVerified." }, // judge candidate 3
    ]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.content[0].text).toContain("1. High coupling in auth module");
    expect(result.content[0].text).not.toContain("2. Missing error boundaries");
    expect(result.content[0].text).toContain("3. Circular dependency in utils");
  });

  it("returns 'no actionable findings' when all candidates are rejected", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "VERDICT: REJECT" },
      { output: "VERDICT: REJECT" },
      { output: "VERDICT: REJECT" },
    ]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.content[0].text).toContain("no actionable findings");
  });

  it("passes all candidates through when all are kept by the judge", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "VERDICT: KEEP" },
      { output: "VERDICT: KEEP" },
      { output: "VERDICT: KEEP" },
    ]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.content[0].text).toContain("1. High coupling in auth module");
    expect(result.content[0].text).toContain("2. Missing error boundaries");
    expect(result.content[0].text).toContain("3. Circular dependency in utils");
  });

  it("shows only validated candidates in the interactive selection prompt", async () => {
    const selectFn = vi.fn(async () => "Skip");
    const pctx = mockPipelineContext({
      ctx: mockForgeflowContext({
        hasUI: true,
        ui: {
          editor: async (_title: string, content: string) => content,
          select: selectFn,
        },
      }),
    });

    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "VERDICT: KEEP" },
      { output: "VERDICT: REJECT" }, // candidate 2 rejected
      { output: "VERDICT: KEEP" },
    ]);

    await runArchitecture(pctx, { runAgentFn });

    // select should have been called with options NOT including candidate 2
    // biome-ignore lint/style/noNonNullAssertion: test assertion — call is guaranteed
    const options = (selectFn.mock.calls as unknown[][])[0]![1] as string[];
    expect(options).toContain("1. High coupling in auth module");
    expect(options).not.toContain("2. Missing error boundaries");
    expect(options).toContain("3. Circular dependency in utils");
  });

  it("returns early with error when reviewer fails, without invoking judge", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "Something went wrong", status: "failed" }]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("invokes the judge once per candidate with correct prompt content", async () => {
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "VERDICT: KEEP" },
      { output: "VERDICT: KEEP" },
      { output: "VERDICT: KEEP" },
    ]);

    const pctx = mockPipelineContext();
    await runArchitecture(pctx, { runAgentFn });

    // 1 reviewer + 3 judge calls
    expect(runAgentFn).toHaveBeenCalledTimes(4);

    // Each judge call should reference "architecture-judge" and include the candidate body
    for (let i = 1; i <= 3; i++) {
      // biome-ignore lint/style/noNonNullAssertion: test assertion — index is guaranteed
      const call = (runAgentFn as ReturnType<typeof vi.fn>).mock.calls[i]!;
      expect(call[0]).toBe("architecture-judge");
      expect(call[1]).toContain("CANDIDATE:");
      expect(call[1]).toContain("FULL ANALYSIS:");
    }
  });
});

describe("parseCandidates", () => {
  it("parses numbered markdown headings into label/body pairs", () => {
    const text = [
      "### 1. High coupling in auth module",
      "Auth is tightly coupled to the database layer.",
      "",
      "### 2. Missing error boundaries",
      "No error boundaries in the React tree.",
    ].join("\n");

    const result = parseCandidates(text);
    expect(result).toHaveLength(2);
    expect(result[0]?.label).toBe("1. High coupling in auth module");
    expect(result[0]?.body).toContain("Auth is tightly coupled");
    expect(result[1]?.label).toBe("2. Missing error boundaries");
    expect(result[1]?.body).toContain("No error boundaries");
  });

  it("returns empty array for input with no numbered headings", () => {
    expect(parseCandidates("")).toEqual([]);
    expect(parseCandidates("Just some text with no candidates")).toEqual([]);
  });
});

describe("parseJudgeVerdict", () => {
  it.each([
    { input: "VERDICT: KEEP\nThe evidence checks out.", expected: "keep" },
    { input: "VERDICT: REJECT\nFile does not exist.", expected: "reject" },
    { input: "Some preamble\nVERDICT: KEEP\nreasoning", expected: "keep" },
    { input: "Some preamble\nVERDICT: REJECT\nreasoning", expected: "reject" },
    { input: "No verdict here at all", expected: "keep" },
    { input: "", expected: "keep" },
  ])("returns $expected for input containing '$input'", ({ input, expected }) => {
    expect(parseJudgeVerdict(input)).toBe(expected);
  });
});
