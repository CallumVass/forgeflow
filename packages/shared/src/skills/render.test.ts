import { describe, expect, it } from "vitest";
import { renderCompactSkillScanReport, renderCompactSkillSelectionReport } from "./index.js";
import type { SkillScanReport, SkillSelectionReport } from "./types.js";

function baseSelectionReport(command: SkillSelectionReport["command"]): SkillSelectionReport {
  return {
    command,
    rootsScanned: [],
    diagnostics: [],
    discoveredSkills: [],
    duplicates: [],
    repoRoot: "/repo",
    changedFiles: [],
    focusPaths: [],
    signals: [],
    selectedSkills: [
      {
        name: command === "review" ? "code-review" : "tdd",
        description: "Helpful skill",
        filePath: `/repo/skills/${command}.md`,
        score: 10,
        reasons: [`Directly useful during ${command}`],
        root: {
          path: "/repo/skills",
          scope: "project",
          harness: "agents",
          distance: 0,
          precedence: 20_000,
        },
      },
    ],
  };
}

describe("compact skill scan renderers", () => {
  it("renders a concise per-stage selection summary", () => {
    const text = renderCompactSkillSelectionReport(baseSelectionReport("review"));

    expect(text).toContain("Skill scan (review)");
    expect(text).toContain("Stage: review");
    expect(text).toContain("- code-review — used during review");
    expect(text).toContain("Use --verbose");
  });

  it("renders a concise multi-stage summary", () => {
    const report: SkillScanReport = {
      rootsScanned: [],
      diagnostics: [],
      discoveredSkills: [],
      duplicates: [],
      repoRoot: "/repo",
      analyses: [baseSelectionReport("implement"), baseSelectionReport("review")],
    };

    const text = renderCompactSkillScanReport(report);

    expect(text).toContain("Skill scan summary");
    expect(text).toContain("- implement:");
    expect(text).toContain("- tdd — used during implement");
    expect(text).toContain("- review:");
    expect(text).toContain("- code-review — used during review");
  });
});
