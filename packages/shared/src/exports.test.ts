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
