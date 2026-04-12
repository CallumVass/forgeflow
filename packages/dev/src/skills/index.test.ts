import {
  mockPipelineAgentRuntime,
  mockPipelineExecRuntime,
  mockPipelineSkillRuntime,
} from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = {
  name: "skills.sh",
  search: vi.fn(),
};

vi.mock("../pipelines/review/index.js", () => ({
  resolveReviewChangedFiles: vi.fn(async () => ["src/foo.ts", "src/bar.ts"]),
}));

vi.mock("./judge.js", () => ({
  judgeSkillScanReport: vi.fn(async (report) => ({ analyses: report.analyses, judgeDiagnostics: [], stages: [] })),
  judgeSkillRecommendationReport: vi.fn(async (report) => ({ report, judgeDiagnostics: [], stages: [] })),
}));

vi.mock("@callumvass/forgeflow-shared/skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared/skills")>();
  return {
    ...actual,
    buildSkillScanReport: vi.fn(async () => ({ analyses: [{ command: "review" }] })),
    renderCompactSkillScanReport: vi.fn(() => "rendered compact skill scan report"),
    renderCompactSkillSelectionReport: vi.fn(() => "rendered compact skill selection report"),
    renderSkillScanReport: vi.fn(() => "rendered verbose skill scan report"),
    renderSkillSelectionReport: vi.fn(() => "rendered verbose skill selection report"),
    createSkillsCliRecommendationProvider: vi.fn(() => provider),
    buildSkillRecommendationReport: vi.fn(async () => ({
      command: "review",
      repoRoot: "/repo",
      provider: "skills.sh",
      recommendedSkills: [{ id: "community/skills@vitest" }],
      searchQueries: [{ query: "vitest", weight: 10, reasons: [] }],
      skippedInstalledSkillNames: ["tailwind"],
    })),
    renderCompactSkillRecommendationReport: vi.fn(() => "rendered compact recommendation report"),
    renderSkillRecommendationReport: vi.fn(() => "rendered verbose recommendation report"),
  };
});

import {
  buildSkillRecommendationReport,
  buildSkillScanReport,
  createSkillsCliRecommendationProvider,
  renderCompactSkillRecommendationReport,
  renderCompactSkillScanReport,
  renderCompactSkillSelectionReport,
  renderSkillRecommendationReport,
  renderSkillScanReport,
  renderSkillSelectionReport,
} from "@callumvass/forgeflow-shared/skills";
import { resolveReviewChangedFiles } from "../pipelines/review/index.js";
import { runSkillRecommend, runSkillScan } from "./index.js";
import { judgeSkillRecommendationReport, judgeSkillScanReport } from "./judge.js";

function skillRuntime() {
  return {
    ...mockPipelineSkillRuntime({ cwd: "/repo" }),
    ...mockPipelineExecRuntime({ cwd: "/repo" }),
    ...mockPipelineAgentRuntime({ cwd: "/repo" }),
  };
}

describe("repo skill pipelines", () => {
  beforeEach(() => {
    vi.mocked(resolveReviewChangedFiles).mockClear();
    vi.mocked(buildSkillScanReport).mockClear();
    vi.mocked(buildSkillRecommendationReport).mockClear();
    vi.mocked(createSkillsCliRecommendationProvider).mockClear();
    vi.mocked(renderCompactSkillSelectionReport).mockClear();
    vi.mocked(renderCompactSkillScanReport).mockClear();
    vi.mocked(renderCompactSkillRecommendationReport).mockClear();
    vi.mocked(renderSkillRecommendationReport).mockClear();
    vi.mocked(renderSkillSelectionReport).mockClear();
    vi.mocked(renderSkillScanReport).mockClear();
    vi.mocked(judgeSkillScanReport).mockClear();
    vi.mocked(judgeSkillRecommendationReport).mockClear();
  });

  it("uses the review public entry point for review-target skill scans and forwards the resolved changed files", async () => {
    const pctx = skillRuntime();

    const result = await runSkillScan({ command: "review", target: "5" }, pctx);
    const verboseResult = await runSkillScan({ command: "review", target: "5", verbose: true }, pctx);

    expect(resolveReviewChangedFiles).toHaveBeenCalledWith("5", pctx);
    expect(buildSkillScanReport).toHaveBeenCalledWith("/repo", pctx.skillsConfig, [
      {
        command: "review",
        issueText: undefined,
        changedFiles: ["src/foo.ts", "src/bar.ts"],
        focusPaths: [],
      },
    ]);
    expect(judgeSkillScanReport).toHaveBeenCalledTimes(2);
    expect(renderCompactSkillSelectionReport).toHaveBeenCalled();
    expect(renderSkillSelectionReport).toHaveBeenCalled();
    expect(result.content[0]?.text).toBe("rendered compact skill selection report");
    expect(verboseResult.content[0]?.text).toBe("rendered verbose skill selection report");
  });

  it("uses the review public entry point for review-target skill recommendations without changing the call-site contract", async () => {
    const pctx = skillRuntime();

    const jsonResult = await runSkillRecommend(
      { command: "review", target: "5", issue: "tailwind", limit: 5, json: true },
      pctx,
    );
    const textResult = await runSkillRecommend({ command: "review", target: "5", issue: "tailwind", limit: 5 }, pctx);
    const verboseTextResult = await runSkillRecommend(
      { command: "review", target: "5", issue: "tailwind", limit: 5, verbose: true },
      pctx,
    );

    expect(resolveReviewChangedFiles).toHaveBeenCalledWith("5", pctx);
    expect(createSkillsCliRecommendationProvider).toHaveBeenCalledWith(pctx.execSafeFn, "/repo");
    expect(buildSkillRecommendationReport).toHaveBeenCalledWith(
      "/repo",
      pctx.skillsConfig,
      {
        command: "review",
        issueText: "tailwind",
        changedFiles: ["src/foo.ts", "src/bar.ts"],
        focusPaths: [],
      },
      provider,
      5,
    );
    expect(judgeSkillRecommendationReport).toHaveBeenCalledTimes(3);
    expect(jsonResult.content[0]?.text).toContain('"provider": "skills.sh"');
    expect(textResult.content[0]?.text).toBe("rendered compact recommendation report");
    expect(verboseTextResult.content[0]?.text).toBe("rendered verbose recommendation report");
    expect(renderCompactSkillRecommendationReport).toHaveBeenCalled();
    expect(renderSkillRecommendationReport).toHaveBeenCalled();
  });
});
