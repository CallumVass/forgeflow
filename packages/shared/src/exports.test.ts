import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural tests verifying the sub-module export split.
 * These read source files to verify import patterns match the acceptance criteria.
 */

const sharedPkgJson = () => JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

describe("package.json exports map", () => {
  it("has sub-path exports for all modules", () => {
    const pkg = sharedPkgJson();
    const exports = pkg.exports as Record<string, string>;

    expect(exports["."]).toBe("./dist/index.js");
    expect(exports["./types"]).toBe("./dist/types.js");
    expect(exports["./exec"]).toBe("./dist/exec.js");
    expect(exports["./agent"]).toBe("./dist/run-agent.js");
    expect(exports["./signals"]).toBe("./dist/signals.js");
    expect(exports["./rendering"]).toBe("./dist/rendering.js");
    expect(exports["./confluence"]).toBe("./dist/confluence.js");
    expect(exports["./testing"]).toBe("./dist/test-utils.js");
    expect(exports["./constants"]).toBe("./dist/constants.js");
    expect(exports["./extension"]).toBe("./dist/extension.js");
    expect(exports["./di"]).toBe("./dist/di.js");
    expect(exports["./arg-parsing"]).toBe("./dist/arg-parsing.js");
    expect(exports["./progress"]).toBe("./dist/progress.js");
    expect(exports["./message-parser"]).toBe("./dist/message-parser.js");
    expect(exports["./context"]).toBe("./dist/context.js");
    expect(exports["./stage"]).toBe("./dist/stage.js");
  });
});

describe("barrel does not re-export test-utils", () => {
  it("index.ts does not export mockRunAgent, mockForgeflowContext, mockPipelineContext, makeStage, makeAssistantMessage, or mockTheme", () => {
    const indexSrc = readFileSync(resolve(__dirname, "index.ts"), "utf-8");

    expect(indexSrc).not.toContain("mockRunAgent");
    expect(indexSrc).not.toContain("mockForgeflowContext");
    expect(indexSrc).not.toContain("mockPipelineContext");
    expect(indexSrc).not.toContain("makeStage");
    expect(indexSrc).not.toContain("makeAssistantMessage");
    expect(indexSrc).not.toContain("mockTheme");
    expect(indexSrc).not.toContain("test-utils");
  });
});

describe("context.ts exports exactly the specified symbols", () => {
  it("exports ForgeflowUI, ForgeflowContext, ForgeflowTheme, PipelineContext, toPipelineContext, toAgentOpts", () => {
    const src = readFileSync(resolve(__dirname, "context.ts"), "utf-8");

    // Must export these
    expect(src).toMatch(/export\s+(interface|type)\s+ForgeflowUI/);
    expect(src).toMatch(/export\s+(interface|type)\s+ForgeflowContext/);
    expect(src).toMatch(/export\s+(interface|type)\s+ForgeflowTheme/);
    expect(src).toMatch(/export\s+(interface|type)\s+PipelineContext/);
    expect(src).toMatch(/export\s+function\s+toPipelineContext/);
    // toAgentOpts lives here to avoid circular dep (context → stage, not stage → context)
    expect(src).toMatch(/export\s+function\s+toAgentOpts/);
  });
});

describe("stage.ts exports exactly the specified symbols", () => {
  it("exports StageResult, UsageStats, PipelineDetails, OnUpdate, RunAgentOpts, RunAgentFn, emptyStage, emptyUsage, sumUsage, PipelineResult, pipelineResult", () => {
    const src = readFileSync(resolve(__dirname, "stage.ts"), "utf-8");

    expect(src).toMatch(/export\s+interface\s+StageResult/);
    expect(src).toMatch(/export\s+interface\s+UsageStats/);
    expect(src).toMatch(/export\s+interface\s+PipelineDetails/);
    expect(src).toMatch(/export\s+type\s+OnUpdate/);
    expect(src).toMatch(/export\s+type\s+RunAgentOpts/);
    expect(src).toMatch(/export\s+type\s+RunAgentFn/);
    expect(src).toMatch(/export\s+function\s+emptyStage/);
    expect(src).toMatch(/export\s+function\s+emptyUsage/);
    expect(src).toMatch(/export\s+function\s+sumUsage/);
    expect(src).toMatch(/export\s+type\s+PipelineResult/);
    expect(src).toMatch(/export\s+function\s+pipelineResult/);
  });
});

describe("getFinalOutput lives in message-parser.ts", () => {
  it("message-parser.ts defines getFinalOutput", () => {
    const src = readFileSync(resolve(__dirname, "message-parser.ts"), "utf-8");
    expect(src).toMatch(/export\s+function\s+getFinalOutput/);
  });

  it("rendering.ts imports getFinalOutput from ./message-parser.js", () => {
    const src = readFileSync(resolve(__dirname, "rendering.ts"), "utf-8");
    expect(src).toContain('from "./message-parser.js"');
    expect(src).not.toMatch(/getFinalOutput.*from\s+["']\.\/types\.js["']/);
  });
});

describe("extension.ts and rendering.ts import from ./context.js", () => {
  it("extension.ts imports ForgeflowContext/ForgeflowTheme from ./context.js", () => {
    const src = readFileSync(resolve(__dirname, "extension.ts"), "utf-8");
    expect(src).toContain('from "./context.js"');
    expect(src).not.toMatch(/ForgeflowContext.*from\s+["']\.\/types\.js["']/);
    expect(src).not.toMatch(/ForgeflowTheme.*from\s+["']\.\/types\.js["']/);
  });

  it("rendering.ts imports ForgeflowTheme from ./context.js", () => {
    const src = readFileSync(resolve(__dirname, "rendering.ts"), "utf-8");
    expect(src).toContain('from "./context.js"');
  });
});

describe("package.json exports include ./context and ./stage sub-paths", () => {
  it("has ./context and ./stage exports with matching typesVersions", () => {
    const pkg = sharedPkgJson();
    const exports = pkg.exports as Record<string, string>;
    expect(exports["./context"]).toBe("./dist/context.js");
    expect(exports["./stage"]).toBe("./dist/stage.js");

    const tv = pkg.typesVersions["*"] as Record<string, string[]>;
    expect(tv.context).toEqual(["dist/context.d.ts"]);
    expect(tv.stage).toEqual(["dist/stage.d.ts"]);
  });
});

describe("no production file in dev/ or pm/ imports from @callumvass/forgeflow-shared/types", () => {
  const prodFiles = [
    "../../dev/src/index.ts",
    "../../dev/src/utils/ui.ts",
    "../../dev/src/pipelines/architecture.ts",
    "../../dev/src/pipelines/discover-skills.ts",
    "../../dev/src/pipelines/implement.ts",
    "../../dev/src/pipelines/implement-all.ts",
    "../../dev/src/pipelines/implement-phases.ts",
    "../../dev/src/pipelines/planning.ts",
    "../../dev/src/pipelines/review.ts",
    "../../dev/src/pipelines/review-comments.ts",
    "../../dev/src/pipelines/review-orchestrator.ts",
    "../../pm/src/index.ts",
    "../../pm/src/pipelines/continue.ts",
    "../../pm/src/pipelines/create-issues.ts",
    "../../pm/src/pipelines/investigate.ts",
    "../../pm/src/pipelines/jira-issues.ts",
    "../../pm/src/pipelines/prd-qa.ts",
    "../../pm/src/pipelines/qa-loop.ts",
  ];

  it.each(prodFiles)("%s does not import from @callumvass/forgeflow-shared/types", (relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), "utf-8");
    expect(src).not.toContain("@callumvass/forgeflow-shared/types");
  });
});

describe("no circular dependency between context.ts and stage.ts", () => {
  it("stage.ts has no imports from context.ts", () => {
    const src = readFileSync(resolve(__dirname, "stage.ts"), "utf-8");
    expect(src).not.toMatch(/from\s+["']\.\/context(\.js)?["']/);
  });
});

describe("types.ts contains only re-exports", () => {
  it("has no function, interface, or type declarations — only re-exports", () => {
    const src = readFileSync(resolve(__dirname, "types.ts"), "utf-8");
    // No direct declarations — only re-exports
    expect(src).not.toMatch(/^export\s+function\s/m);
    expect(src).not.toMatch(/^export\s+interface\s/m);
    expect(src).not.toMatch(/^export\s+type\s+\w+\s*=/m);
  });
});

describe("barrel re-exports from new modules", () => {
  it("index.ts re-exports from ./context.js and ./stage.js", () => {
    const src = readFileSync(resolve(__dirname, "index.ts"), "utf-8");
    expect(src).toContain("./context.js");
    expect(src).toContain("./stage.js");
    expect(src).toContain("pipelineResult");
    expect(src).toContain("PipelineResult");
  });
});

describe("no inline content constructions remain in pipeline files", () => {
  const pipelineFiles = [
    "../../dev/src/pipelines/implement.ts",
    "../../dev/src/pipelines/implement-all.ts",
    "../../dev/src/pipelines/architecture.ts",
    "../../dev/src/pipelines/review.ts",
    "../../dev/src/pipelines/discover-skills.ts",
    "../../pm/src/pipelines/continue.ts",
    "../../pm/src/pipelines/prd-qa.ts",
    "../../pm/src/pipelines/create-issues.ts",
    "../../pm/src/pipelines/investigate.ts",
    "../../pm/src/pipelines/jira-issues.ts",
  ];

  it.each(pipelineFiles)('%s has no inline content: [{ type: "text" constructions', (relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), "utf-8");
    expect(src).not.toMatch(/content:\s*\[\{\s*type:\s*["']text["']/);
  });

  it.each(pipelineFiles)("%s has no local result() / reviewResult / TextResult helpers", (relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), "utf-8");
    // No local result function declarations
    expect(src).not.toMatch(/^function result\(/m);
    expect(src).not.toMatch(/^const reviewResult/m);
    expect(src).not.toMatch(/^type TextResult/m);
  });
});

describe("no production files import from the bare barrel", () => {
  const prodFiles = [
    // dev production files
    "../../dev/src/index.ts",
    "../../dev/src/commands.ts",
    "../../dev/src/utils/ui.ts",
    "../../dev/src/utils/git.ts",
    "../../dev/src/utils/git-workflow.ts",
    "../../dev/src/pipelines/architecture.ts",
    "../../dev/src/pipelines/discover-skills.ts",
    "../../dev/src/pipelines/implement.ts",
    "../../dev/src/pipelines/implement-all.ts",
    "../../dev/src/pipelines/planning.ts",
    "../../dev/src/pipelines/review.ts",
    "../../dev/src/pipelines/review-comments.ts",
    "../../dev/src/pipelines/review-diff.ts",
    "../../dev/src/pipelines/review-orchestrator.ts",
    // pm production files
    "../../pm/src/index.ts",
    "../../pm/src/commands.ts",
    "../../pm/src/pipelines/continue.ts",
    "../../pm/src/pipelines/create-issues.ts",
    "../../pm/src/pipelines/investigate.ts",
    "../../pm/src/pipelines/jira-issues.ts",
    "../../pm/src/pipelines/prd-qa.ts",
    "../../pm/src/pipelines/qa-loop.ts",
  ];

  it.each(prodFiles)("%s uses sub-path imports, not the bare barrel", (relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), "utf-8");
    const lines = src.split("\n");

    for (const line of lines) {
      if (line.includes("@callumvass/forgeflow-shared")) {
        // Must use a sub-path — not the bare specifier
        expect(line).toMatch(/@callumvass\/forgeflow-shared\//);
      }
    }
  });
});

describe("no test file uses the barrel vi.mock importOriginal pattern", () => {
  const testFiles = [
    "../../dev/src/pipelines/review.test.ts",
    "../../dev/src/pipelines/review-orchestrator.test.ts",
    "../../dev/src/pipelines/implement.test.ts",
    "../../pm/src/pipelines/continue.test.ts",
  ];

  it.each(
    testFiles,
  )("%s does not use vi.mock('@callumvass/forgeflow-shared', async (importOriginal) => ...)", (relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), "utf-8");

    expect(src).not.toContain('vi.mock("@callumvass/forgeflow-shared", async');
    expect(src).not.toContain("vi.mock('@callumvass/forgeflow-shared', async");
    // Also check it doesn't mock the bare barrel at all
    expect(src).not.toMatch(/vi\.mock\(["']@callumvass\/forgeflow-shared["']\s*,/);
  });
});
