import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SKILLS } from "../config/forgeflow-config.js";
import { setupIsolatedHomeFixture } from "../testing/index.js";
import {
  buildSkillRecommendationReport,
  buildSkillSearchQueries,
  createSkillsCliRecommendationProvider,
  parseSkillsFindOutput,
  renderSkillRecommendationReport,
} from "./index.js";
import type { SkillRecommendationProvider, SkillRecommendationReport, SkillSignal } from "./types.js";

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

  it("renders a concise recommendation report with top installs first", () => {
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
      providerDiagnostics: [],
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
