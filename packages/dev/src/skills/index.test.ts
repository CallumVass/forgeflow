import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = {
  name: "skills.sh",
  search: vi.fn(),
};

vi.mock("../pipelines/review/index.js", () => ({
  resolveReviewChangedFiles: vi.fn(async () => ["src/foo.ts", "src/bar.ts"]),
}));

vi.mock("@callumvass/forgeflow-shared/skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared/skills")>();
  return {
    ...actual,
    buildSkillScanReport: vi.fn(async () => ({ analyses: [{ command: "review" }] })),
    renderSkillScanReport: vi.fn(() => "rendered skill scan report"),
    renderSkillSelectionReport: vi.fn(() => "rendered skill selection report"),
    createSkillsCliRecommendationProvider: vi.fn(() => provider),
    buildSkillRecommendationReport: vi.fn(async () => ({
      command: "review",
      repoRoot: "/repo",
      provider: "skills.sh",
      recommendedSkills: [{ id: "community/skills@vitest" }],
      searchQueries: [{ query: "vitest", weight: 10, reasons: [] }],
      skippedInstalledSkillNames: ["tailwind"],
    })),
    renderSkillRecommendationReport: vi.fn(() => "rendered recommendation report"),
  };
});

import {
  buildSkillRecommendationReport,
  buildSkillScanReport,
  createSkillsCliRecommendationProvider,
  renderSkillRecommendationReport,
} from "@callumvass/forgeflow-shared/skills";
import { resolveReviewChangedFiles } from "../pipelines/review/index.js";
import { runSkillRecommend, runSkillScan } from "./index.js";

describe("repo skill pipelines", () => {
  beforeEach(() => {
    vi.mocked(resolveReviewChangedFiles).mockClear();
    vi.mocked(buildSkillScanReport).mockClear();
    vi.mocked(buildSkillRecommendationReport).mockClear();
    vi.mocked(createSkillsCliRecommendationProvider).mockClear();
    vi.mocked(renderSkillRecommendationReport).mockClear();
  });

  it("uses the review public entry point for review-target skill scans and forwards the resolved changed files", async () => {
    const pctx = mockPipelineContext({ cwd: "/repo" });

    const result = await runSkillScan({ command: "review", target: "5" }, pctx);

    expect(resolveReviewChangedFiles).toHaveBeenCalledWith("5", pctx);
    expect(buildSkillScanReport).toHaveBeenCalledWith("/repo", pctx.skillsConfig, [
      {
        command: "review",
        issueText: undefined,
        changedFiles: ["src/foo.ts", "src/bar.ts"],
        focusPaths: [],
      },
    ]);
    expect(result.content[0]?.text).toBe("rendered skill selection report");
  });

  it("uses the review public entry point for review-target skill recommendations without changing the call-site contract", async () => {
    const pctx = mockPipelineContext({ cwd: "/repo" });

    const jsonResult = await runSkillRecommend(
      { command: "review", target: "5", issue: "tailwind", limit: 5, json: true },
      pctx,
    );
    const textResult = await runSkillRecommend({ command: "review", target: "5", issue: "tailwind", limit: 5 }, pctx);

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
    expect(jsonResult.content[0]?.text).toContain('"provider": "skills.sh"');
    expect(textResult.content[0]?.text).toBe("rendered recommendation report");
    expect(renderSkillRecommendationReport).toHaveBeenCalled();
  });
});
