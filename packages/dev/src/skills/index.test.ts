import { mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";

const provider = {
  name: "skills.sh",
  search: vi.fn(),
};

vi.mock("@callumvass/forgeflow-shared/skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@callumvass/forgeflow-shared/skills")>();
  return {
    ...actual,
    createSkillsCliRecommendationProvider: vi.fn(() => provider),
    buildSkillRecommendationReport: vi.fn(async () => ({
      command: "implement",
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
  createSkillsCliRecommendationProvider,
  renderSkillRecommendationReport,
} from "@callumvass/forgeflow-shared/skills";
import { runSkillRecommend } from "./index.js";

describe("runSkillRecommend", () => {
  it("returns JSON for --json and rendered text otherwise without changing the call-site contract", async () => {
    const pctx = mockPipelineContext({ cwd: "/repo" });

    const jsonResult = await runSkillRecommend({ issue: "tailwind", limit: 5, json: true }, pctx);
    const textResult = await runSkillRecommend({ issue: "tailwind", limit: 5 }, pctx);

    expect(createSkillsCliRecommendationProvider).toHaveBeenCalledWith(pctx.execSafeFn, "/repo");
    expect(buildSkillRecommendationReport).toHaveBeenCalledWith(
      "/repo",
      pctx.skillsConfig,
      {
        command: "implement",
        issueText: "tailwind",
        changedFiles: [],
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
