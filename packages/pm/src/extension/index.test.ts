import {
  getRegisteredToolDefinition,
  mockForgeflowContext,
  mockPi,
  mockTheme,
} from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createPmExtension from "./index.js";

const {
  runInit,
  runContinue,
  runPrdQa,
  runCreateIssues,
  runCreateIssue,
  runInvestigate,
  runJiraIssues,
  runAtlassianRead,
} = vi.hoisted(() => ({
  runInit: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "init done" }],
    details: { pipeline: "init", stages: [] },
  })),
  runContinue: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "continue done" }],
    details: { pipeline: "continue", stages: [] },
  })),
  runPrdQa: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "qa done" }],
    details: { pipeline: "prd-qa", stages: [] },
  })),
  runCreateIssues: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "issues done" }],
    details: { pipeline: "create-gh-issues", stages: [] },
  })),
  runCreateIssue: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "issue done" }],
    details: { pipeline: "create-gh-issue", stages: [] },
  })),
  runInvestigate: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "investigate done" }],
    details: { pipeline: "investigate", stages: [] },
  })),
  runJiraIssues: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "jira done" }],
    details: { pipeline: "create-jira-issues", stages: [] },
  })),
  runAtlassianRead: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "read done" }],
    details: { pipeline: "atlassian-read", stages: [] },
  })),
}));

vi.mock("../pipelines/init.js", () => ({ runInit }));
vi.mock("../pipelines/continue.js", () => ({ runContinue }));
vi.mock("../pipelines/prd-qa.js", () => ({ runPrdQa }));
vi.mock("../pipelines/issue-creation/github.js", () => ({ runCreateIssue, runCreateIssues }));
vi.mock("../pipelines/investigate.js", () => ({ runInvestigate }));
vi.mock("../pipelines/issue-creation/jira.js", () => ({ runJiraIssues }));
vi.mock("../pipelines/atlassian-read.js", () => ({ runAtlassianRead }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pm extension", () => {
  it("registers forgeflow-pm with the current PM commands and call rendering", () => {
    const pi = mockPi();

    createPmExtension("file:///repo/packages/pm/extensions/index.js")(pi as never);

    const toolDef = getRegisteredToolDefinition(pi);
    expect(toolDef.name).toBe("forgeflow-pm");
    expect(toolDef.parameters.properties.pipeline.description).toContain('"init"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"continue"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"prd-qa"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"create-gh-issues"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"create-gh-issue"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"investigate"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"create-jira-issues"');
    expect(toolDef.parameters.properties.pipeline.description).toContain('"atlassian-read"');
    expect(pi.registerCommand.mock.calls.map((call: unknown[]) => call[0])).toEqual(
      expect.arrayContaining(["init", "continue", "prd-qa", "create-gh-issues", "create-gh-issue", "investigate"]),
    );
    expect(pi.registerCommand.mock.calls.map((call: unknown[]) => call[0])).toEqual(
      expect.arrayContaining(["atlassian-login", "atlassian-status", "atlassian-logout", "atlassian-read"]),
    );

    const text = toolDef
      .renderCall({ pipeline: "continue", issue: "Phase 2", maxIterations: 3 }, mockTheme(), {})
      .render(120)
      .join("\n");
    expect(text).toContain("[accent]continue");
    expect(text).toContain('[dim] "Phase 2"');
    expect(text).toContain("[muted] (max 3)");
  });

  it("executes PM pipelines with a PipelineContext built from the package agents directory", async () => {
    const pi = mockPi();
    createPmExtension("file:///repo/packages/pm/extensions/index.js")(pi as never);

    const toolDef = getRegisteredToolDefinition(pi);
    const ctx = mockForgeflowContext({ cwd: "/repo/project" });
    await toolDef.execute(
      "call-1",
      { pipeline: "continue", issue: "Ship docs" },
      AbortSignal.timeout(5000),
      vi.fn(),
      ctx,
    );

    expect(runContinue).toHaveBeenCalledWith(
      "Ship docs",
      10,
      expect.objectContaining({
        cwd: "/repo/project",
        ctx,
        agentsDir: "/repo/packages/pm/agents",
      }),
    );
  });
});
