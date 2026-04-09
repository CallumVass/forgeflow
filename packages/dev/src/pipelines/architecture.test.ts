import {
  type CustomCapture,
  firstCustomCapture,
  makeCustomUiMock,
  mockForgeflowContext,
  mockPipelineContext,
  sequencedRunAgent,
} from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { type ArchitectureCandidate, parseCandidates, runArchitecture } from "./architecture.js";

type PickerResult = ArchitectureCandidate[] | null | undefined;

type PickerComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
};

function mountPicker<T>(
  capture: CustomCapture<T>,
  theme: { fg: (c: string, s: string) => string; bold: (s: string) => string },
): PickerComponent {
  return capture.factory(capture.tui as never, theme, null, capture.done) as PickerComponent;
}

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

    const pctx = mockPipelineContext({ runAgentFn });
    const result = await runArchitecture(pctx);

    expect(result.content[0].text).toContain("1. High coupling in auth module");
    expect(result.content[0].text).toContain("2. Missing error boundaries");
    expect(result.content[0].text).toContain("3. Circular dependency in utils");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("returns early with error when reviewer fails", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "Something went wrong", status: "failed" }]);

    const pctx = mockPipelineContext({ runAgentFn });
    const result = await runArchitecture(pctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("returns raw reviewer output when no candidates parse", async () => {
    const runAgentFn = sequencedRunAgent([{ output: "Some free-form reviewer notes with no numbered headings." }]);

    const pctx = mockPipelineContext({ runAgentFn });
    const result = await runArchitecture(pctx);

    expect(result.content[0].text).toContain("Some free-form reviewer notes with no numbered headings.");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("creates RFC issues only for the toggled multi-candidate subset", async () => {
    const { custom, captures } = makeCustomUiMock<PickerResult>();
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "Created https://github.com/acme/repo/issues/101" },
      { output: "Created https://github.com/acme/repo/issues/103" },
    ]);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        custom: custom as never,
      },
    });
    const pctx = mockPipelineContext({ runAgentFn, ctx });

    const resultPromise = runArchitecture(pctx);

    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    const capture = firstCustomCapture(captures);
    const component = mountPicker(capture, ctx.ui.theme);

    const initialRender = component.render(120).join("\n");
    expect(initialRender).toContain("1. High coupling in auth module");
    expect(initialRender).toContain("2. Missing error boundaries");
    expect(initialRender).toContain("3. Circular dependency in utils");
    expect(initialRender).toContain("[ ]");

    component.handleInput?.(" ");
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\u001b[B");
    component.handleInput?.(" ");
    component.handleInput?.("\r");

    const result = await resultPromise;

    expect(result.content[0].text).toContain("https://github.com/acme/repo/issues/101");
    expect(result.content[0].text).toContain("https://github.com/acme/repo/issues/103");
    expect(result.content[0].text).not.toContain("issues/102");
    expect(runAgentFn).toHaveBeenCalledTimes(3);
    expect(runAgentFn.mock.calls[1]?.[1]).toContain("High coupling in auth module");
    expect(runAgentFn.mock.calls[2]?.[1]).toContain("Circular dependency in utils");
  });

  it("does not hide the multi-candidate picker behind a terminal width gate", async () => {
    const { custom, captures } = makeCustomUiMock<PickerResult>();
    const runAgentFn = sequencedRunAgent([{ output: THREE_CANDIDATES }]);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        custom: custom as never,
      },
    });

    const resultPromise = runArchitecture(mockPipelineContext({ runAgentFn, ctx }));

    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    const capture = firstCustomCapture(captures);

    expect(capture.options).toMatchObject({
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "80%",
        maxHeight: "80%",
      },
    });
    expect(capture.options?.overlayOptions?.visible).toBeUndefined();

    capture.done(null);
    const result = await resultPromise;
    expect(result.content[0].text).toBe("Architecture review complete. No RFC created.");
  });

  it("shows the re-parsed edited candidates in the toggle picker", async () => {
    const editedCandidates = [
      "### 1. Extract shared CLI formatter",
      "Multiple pipelines rebuild the same CLI output formatting.",
      "",
      "### 2. Split review orchestration",
      "Review orchestration now owns too many concerns.",
    ].join("\n");
    const { custom, captures } = makeCustomUiMock<PickerResult>();
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "Created https://github.com/acme/repo/issues/201" },
    ]);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async () => editedCandidates,
        custom: custom as never,
      },
    });
    const pctx = mockPipelineContext({ runAgentFn, ctx });

    const resultPromise = runArchitecture(pctx);

    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    const capture = firstCustomCapture(captures);
    const component = mountPicker(capture, ctx.ui.theme);
    const render = component.render(120).join("\n");
    expect(render).toContain("1. Extract shared CLI formatter");
    expect(render).toContain("2. Split review orchestration");
    expect(render).not.toContain("1. High coupling in auth module");

    component.handleInput?.(" ");
    component.handleInput?.("\r");

    const result = await resultPromise;

    expect(result.content[0].text).toContain("https://github.com/acme/repo/issues/201");
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(runAgentFn.mock.calls[1]?.[1]).toContain("Extract shared CLI formatter");
    expect(runAgentFn.mock.calls[1]?.[1]).not.toContain("High coupling in auth module");
  });

  it("treats a confirmed empty toggle selection as no RFC created", async () => {
    const { custom, captures } = makeCustomUiMock<PickerResult>();
    const runAgentFn = sequencedRunAgent([{ output: THREE_CANDIDATES }]);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        custom: custom as never,
      },
    });
    const pctx = mockPipelineContext({ runAgentFn, ctx });

    const resultPromise = runArchitecture(pctx);

    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    const capture = firstCustomCapture(captures);
    const component = mountPicker(capture, ctx.ui.theme);
    component.handleInput?.("\r");

    const result = await resultPromise;

    expect(result.content[0].text).toBe("Architecture review complete. No RFC created.");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("treats a cancelled toggle picker as no RFC created", async () => {
    const { custom, captures } = makeCustomUiMock<PickerResult>();
    const runAgentFn = sequencedRunAgent([{ output: THREE_CANDIDATES }]);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        custom: custom as never,
      },
    });
    const pctx = mockPipelineContext({ runAgentFn, ctx });

    const resultPromise = runArchitecture(pctx);

    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    const capture = firstCustomCapture(captures);
    const component = mountPicker(capture, ctx.ui.theme);
    component.handleInput?.("\u001b");

    const result = await resultPromise;

    expect(result.content[0].text).toBe("Architecture review complete. No RFC created.");
    expect(runAgentFn).toHaveBeenCalledOnce();
  });

  it("falls back to select when custom UI is unsupported for multiple candidates", async () => {
    const selectFn = vi.fn(async () => "2. Missing error boundaries");
    const customFn = vi.fn(async () => undefined);
    const runAgentFn = sequencedRunAgent([
      { output: THREE_CANDIDATES },
      { output: "Created https://github.com/acme/repo/issues/102" },
    ]);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        select: selectFn,
        custom: customFn as never,
      },
    });

    const result = await runArchitecture(mockPipelineContext({ runAgentFn, ctx }));

    expect(customFn).toHaveBeenCalledOnce();
    expect(selectFn).toHaveBeenCalledWith("Create RFC issues for which candidates?", [
      "1. High coupling in auth module",
      "2. Missing error boundaries",
      "3. Circular dependency in utils",
      "All candidates",
      "Skip",
    ]);
    expect(result.content[0].text).toContain("https://github.com/acme/repo/issues/102");
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(runAgentFn.mock.calls[1]?.[1]).toContain("Missing error boundaries");
  });

  it("keeps the existing select path for single-candidate and no-candidate interactive runs", async () => {
    const singleCandidate = [
      "### 1. High coupling in auth module",
      "Auth is tightly coupled to the database layer.",
    ].join("\n");
    const selectFn = vi.fn(async () => "Skip");
    const singleCustom = vi.fn(async () => undefined);
    const singleCtx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        select: selectFn,
        custom: singleCustom as never,
      },
    });

    const singleResult = await runArchitecture(
      mockPipelineContext({
        runAgentFn: sequencedRunAgent([{ output: singleCandidate }]),
        ctx: singleCtx,
      }),
    );

    expect(singleResult.content[0].text).toBe("Architecture review complete. No RFC created.");
    expect(singleCustom).not.toHaveBeenCalled();
    expect(selectFn).toHaveBeenCalledWith("Create RFC issues for which candidates?", [
      "1. High coupling in auth module",
      "Skip",
    ]);

    const noCandidateSelect = vi.fn(async () => "Skip");
    const noCandidateCustom = vi.fn(async () => undefined);
    const noCandidateCtx = mockForgeflowContext({
      hasUI: true,
      ui: {
        editor: async (_title: string, content: string) => content,
        select: noCandidateSelect,
        custom: noCandidateCustom as never,
      },
    });

    const noCandidateResult = await runArchitecture(
      mockPipelineContext({
        runAgentFn: sequencedRunAgent([{ output: "Some free-form reviewer notes with no numbered headings." }]),
        ctx: noCandidateCtx,
      }),
    );

    expect(noCandidateResult.content[0].text).toBe("Architecture review complete. No RFC created.");
    expect(noCandidateCustom).not.toHaveBeenCalled();
    expect(noCandidateSelect).toHaveBeenCalledWith("Create RFC issues for which candidates?", [
      "Yes — generate RFC",
      "Skip",
    ]);
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
