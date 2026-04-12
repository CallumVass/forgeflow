import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SKILLS } from "../../config/forgeflow-config.js";
import { setupIsolatedHomeFixture } from "../../testing/index.js";
import type { SkillRecommendationProvider } from "../types.js";
import { buildSkillRecommendationReport } from "./report.js";

function writeSkill(root: string, name: string, description: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

describe("buildSkillRecommendationReport", () => {
  const fixture = setupIsolatedHomeFixture("skills-recommend-report");

  it("omits already installed matches while preserving search queries and recommendation ordering", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "tailwind", "Tailwind CSS guidance.");
    fs.writeFileSync(
      path.join(fixture.cwdDir, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }),
      "utf-8",
    );

    const provider: SkillRecommendationProvider = {
      name: "skills.sh",
      search: vi.fn(async (queries) => ({
        provider: "skills.sh",
        diagnostics: [],
        candidates: [
          {
            id: "community/skills@tailwind",
            slug: "tailwind",
            url: "https://skills.sh/community/skills/tailwind",
            installs: 1000,
            installsLabel: "1K installs",
            matchedQueries: queries.filter((query) => query.query.includes("tailwind")).map((query) => query.query),
          },
          {
            id: "vercel-labs/agent-skills@vercel-react-best-practices",
            slug: "vercel-react-best-practices",
            url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
            installs: 229800,
            installsLabel: "229.8K installs",
            matchedQueries: queries.filter((query) => query.query.includes("react")).map((query) => query.query),
          },
        ],
      })),
    };

    const report = await buildSkillRecommendationReport(
      fixture.cwdDir,
      DEFAULT_SKILLS,
      { command: "implement" },
      provider,
      5,
    );

    expect(report.selectedSkills.map((skill) => skill.name)).toEqual(["tailwind"]);
    expect(report.recommendedSkills.map((skill) => skill.id)).toEqual([
      "vercel-labs/agent-skills@vercel-react-best-practices",
    ]);
    expect(report.skippedInstalledSkillNames).toEqual(["tailwind"]);
    expect(report.searchQueries.map((query) => query.query)).toContain("react");
  });

  it("diversifies recommendations so one library family does not dominate the list", async () => {
    fs.writeFileSync(
      path.join(fixture.cwdDir, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0", vitest: "3.0.0" } }),
      "utf-8",
    );

    const provider: SkillRecommendationProvider = {
      name: "skills.sh",
      search: vi.fn(async () => ({
        provider: "skills.sh",
        diagnostics: [],
        candidates: [
          {
            id: "community/skills@vitest-mocking",
            slug: "vitest-mocking",
            url: "https://skills.sh/community/skills/vitest-mocking",
            installs: 5000,
            installsLabel: "5K installs",
            matchedQueries: ["vitest"],
          },
          {
            id: "community/skills@vitest-config",
            slug: "vitest-config",
            url: "https://skills.sh/community/skills/vitest-config",
            installs: 4000,
            installsLabel: "4K installs",
            matchedQueries: ["vitest"],
          },
          {
            id: "vercel-labs/agent-skills@vercel-react-best-practices",
            slug: "vercel-react-best-practices",
            url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
            installs: 229800,
            installsLabel: "229.8K installs",
            matchedQueries: ["react"],
          },
        ],
      })),
    };

    const report = await buildSkillRecommendationReport(
      fixture.cwdDir,
      DEFAULT_SKILLS,
      { command: "implement" },
      provider,
      5,
    );

    expect(report.recommendedSkills.map((skill) => skill.id)).toEqual([
      "vercel-labs/agent-skills@vercel-react-best-practices",
      "community/skills@vitest-mocking",
    ]);
  });
});
