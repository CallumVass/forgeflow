import { mockForgeflowContext, mockPipelineContext, sequencedRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { parseCandidates, runArchitecture } from "./architecture.js";

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
  it("passes all reviewer candidates through in non-interactive mode", async () => {
    const runAgentFn = sequencedRunAgent([{ output: THREE_CANDIDATES }]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.content[0].text).toContain("1. High coupling in auth module");
    expect(result.content[0].text).toContain("2. Missing error boundaries");
    expect(result.content[0].text).toContain("3. Circular dependency in utils");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("returns early with error when reviewer fails", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "Something went wrong", status: "failed" }]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("returns raw reviewer output when no candidates parse", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "Some free-form reviewer notes with no numbered headings." }]);

    const pctx = mockPipelineContext();
    const result = await runArchitecture(pctx, { runAgentFn });

    expect(result.content[0].text).toContain("Some free-form reviewer notes with no numbered headings.");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("shows all reviewer candidates in the interactive selection prompt", async () => {
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

    const runAgentFn = sequencedRunAgent([{ output: THREE_CANDIDATES }]);

    await runArchitecture(pctx, { runAgentFn });

    // biome-ignore lint/style/noNonNullAssertion: test assertion — call is guaranteed
    const options = (selectFn.mock.calls as unknown[][])[0]![1] as string[];
    expect(options).toEqual([
      "1. High coupling in auth module",
      "2. Missing error boundaries",
      "3. Circular dependency in utils",
      "All candidates",
      "Skip",
    ]);
    expect(runAgentFn).toHaveBeenCalledOnce();
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
