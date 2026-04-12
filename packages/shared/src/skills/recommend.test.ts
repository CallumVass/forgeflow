import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SKILLS } from "../config/forgeflow-config.js";
import { setupIsolatedHomeFixture } from "../test-utils.js";
import {
  buildSkillRecommendationReport,
  buildSkillSearchQueries,
  createSkillsCliRecommendationProvider,
  parseSkillsFindOutput,
} from "./index.js";
import type { SkillRecommendationProvider, SkillSignal } from "./types.js";

function writeSkill(root: string, name: string, description: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

describe("skill recommendations", () => {
  const fixture = setupIsolatedHomeFixture("skills-recommend");

  it("parses skills.sh find output with installs and URLs", () => {
    const output = `
\u001b[38;5;102mInstall with\u001b[0m npx skills add <owner/repo@skill>

\u001b[38;5;145mvercel-labs/agent-skills@vercel-react-best-practices\u001b[0m \u001b[36m229.8K installs\u001b[0m
\u001b[38;5;102m└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices\u001b[0m
`;

    expect(parseSkillsFindOutput(output)).toEqual([
      {
        id: "vercel-labs/agent-skills@vercel-react-best-practices",
        slug: "vercel-react-best-practices",
        url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
        installs: 229800,
        installsLabel: "229.8K installs",
      },
    ]);
  });

  it("builds repo-aware search queries and adds stage-specific variants", () => {
    const signals: SkillSignal[] = [
      {
        kind: "dependency",
        value: "react",
        reason: "package.json: dependency react",
        weight: 4,
        aliases: ["react"],
      },
      {
        kind: "dependency",
        value: "tailwindcss",
        reason: "package.json: dependency tailwindcss",
        weight: 4,
        aliases: ["tailwindcss", "tailwind css", "tailwind"],
      },
    ];

    const queries = buildSkillSearchQueries(signals, "review");

    const queryStrings = queries.map((query) => query.query);

    expect(queryStrings).toContain("react");
    expect(queryStrings.some((query) => query.includes("tailwind"))).toBe(true);
    expect(queryStrings.some((query) => query.includes("react") && query.includes("tailwind"))).toBe(true);
    expect(queryStrings).toContain("react review");
  });

  it("recommends missing remote skills while omitting already installed matches", async () => {
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

  it("caches repeated skills.sh queries inside the provider", async () => {
    const execSafeFn = vi.fn(
      async () => `
vercel-labs/agent-skills@vercel-react-best-practices 229.8K installs
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
`,
    );
    const provider = createSkillsCliRecommendationProvider(execSafeFn, fixture.cwdDir);

    const result = await provider.search([
      { query: "react", weight: 10, reasons: [] },
      { query: "react", weight: 8, reasons: [] },
    ]);

    expect(execSafeFn).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual([
      {
        id: "vercel-labs/agent-skills@vercel-react-best-practices",
        slug: "vercel-react-best-practices",
        url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
        installs: 229800,
        installsLabel: "229.8K installs",
        matchedQueries: ["react"],
      },
    ]);
  });
});
