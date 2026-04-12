import { describe, expect, it } from "vitest";
import type { SkillRecommendationReport } from "../types.js";
import { renderSkillRecommendationReport } from "./render.js";

describe("renderSkillRecommendationReport", () => {
  it("renders the current CLI sections from report data only", () => {
    const report: SkillRecommendationReport = {
      command: "implement",
      rootsScanned: [
        {
          path: "/home/test/.agents/skills",
          scope: "global",
          harness: "agents",
          distance: Number.POSITIVE_INFINITY,
          precedence: 10_000,
        },
      ],
      diagnostics: ["warning: description is required (/home/test/.claude/skills/stitch/SKILL.md)"],
      providerDiagnostics: ["skills.sh search failed for query: tailwind review"],
      provider: "skills.sh",
      discoveredSkills: [],
      duplicates: [],
      repoRoot: "/repo",
      changedFiles: [],
      focusPaths: [],
      signals: Array.from({ length: 13 }, (_, index) => ({
        kind: "dependency" as const,
        value: `signal-${index}`,
        reason: `signal ${index}`,
        weight: 5,
        aliases: [`signal-${index}`],
      })),
      selectedSkills: [
        {
          name: "vitest",
          description: "Vitest guidance",
          filePath: "/repo/.agents/skills/vitest/SKILL.md",
          score: 10,
          reasons: ["package.json: dependency vitest", "vitest.config.ts: vitest.config.ts detected"],
          root: {
            path: "/repo/.agents/skills",
            scope: "project",
            harness: "agents",
            distance: 0,
            precedence: 20_000,
          },
        },
      ],
      searchQueries: [
        {
          query: "vitest",
          weight: 10,
          reasons: ["package.json: dependency vitest", "vitest.config.ts: vitest.config.ts detected"],
        },
      ],
      recommendedSkills: [
        {
          id: "community/skills@vitest",
          slug: "vitest",
          url: "https://skills.sh/community/skills/vitest",
          installs: 1000,
          installsLabel: "1K installs",
          matchedQueries: ["vitest"],
          provider: "skills.sh",
          installCommand: "npx skills add community/skills@vitest",
          score: 20,
          reasons: [
            "package.json: dependency vitest",
            "vitest.config.ts: vitest.config.ts detected",
            "Matched skills.sh queries: vitest",
            "Popularity: 1K installs",
          ],
        },
      ],
      skippedInstalledSkillNames: ["tailwind"],
    };

    const text = renderSkillRecommendationReport(report);

    expect(text).toContain("Skill recommendations (implement)");
    expect(text).toContain("Top recommendations:");
    expect(text).toContain("1) community/skills@vitest — 1K installs");
    expect(text).toContain(
      "why: package.json: dependency vitest; vitest.config.ts: vitest.config.ts detected; Matched skills.sh queries: vitest; +1 more",
    );
    expect(text).toContain("Installed skill names: vitest");
    expect(text).toContain("Repo signals (12 of 13):");
    expect(text).toContain("- +1 more signals");
    expect(text).toContain("Already installed matches omitted:");
    expect(text).toContain("skills.sh diagnostics:");
  });
});
