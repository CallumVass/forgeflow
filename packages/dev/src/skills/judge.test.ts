import { mockPipelineAgentRuntime, mockRunAgent } from "@callumvass/forgeflow-shared/testing";
import { describe, expect, it, vi } from "vitest";
import { judgeSkillRecommendationReport, judgeSkillScanReport } from "./judge.js";

describe("skill judge", () => {
  it("replaces heuristic local selections with the judge's higher-confidence picks", async () => {
    const runAgentFn = mockRunAgent(
      JSON.stringify({
        analyses: [
          {
            command: "implement",
            selected: [
              { name: "tdd", confidence: 94, reason: "Its purpose directly fits feature implementation work." },
            ],
          },
        ],
      }),
    );
    const pctx = mockPipelineAgentRuntime({ cwd: "/repo", runAgentFn });

    const judged = await judgeSkillScanReport(
      {
        analyses: [
          {
            command: "implement",
            rootsScanned: [],
            diagnostics: [],
            discoveredSkills: [
              {
                name: "tdd",
                description: "Test-driven development guidance for building features.",
                filePath: "/repo/packages/dev/skills/tdd/SKILL.md",
                baseDir: "/repo/packages/dev/skills/tdd",
                disableModelInvocation: false,
                root: {
                  path: "/repo/packages/dev/skills",
                  scope: "project",
                  harness: "pi",
                  distance: 2,
                  precedence: 100,
                },
              },
              {
                name: "pixi-js",
                description: "Pixi.js game development with TypeScript.",
                filePath: "/tmp/pixi-js/SKILL.md",
                baseDir: "/tmp/pixi-js",
                disableModelInvocation: false,
                root: { path: "/tmp", scope: "global", harness: "agents", distance: 999, precedence: 10 },
              },
            ],
            duplicates: [],
            repoRoot: "/repo",
            changedFiles: [],
            focusPaths: ["/repo"],
            signals: [
              {
                kind: "dependency",
                value: "typescript",
                reason: "package.json: dependency typescript",
                weight: 4,
                aliases: ["typescript"],
              },
            ],
            selectedSkills: [
              {
                name: "pixi-js",
                description: "Pixi.js game development with TypeScript.",
                filePath: "/tmp/pixi-js/SKILL.md",
                score: 12,
                reasons: ["package.json: dependency typescript"],
                root: { path: "/tmp", scope: "global", harness: "agents", distance: 999, precedence: 10 },
              },
            ],
          },
        ],
      },
      pctx,
    );

    expect(runAgentFn).toHaveBeenCalledOnce();
    expect(judged.analyses[0]?.selectedSkills.map((skill) => skill.name)).toEqual(["tdd"]);
    expect(judged.analyses[0]?.selectedSkills[0]?.judgement?.confidence).toBe(94);
  });

  it("enriches external candidates before applying the judge's recommendation filter", async () => {
    const runAgentFn = mockRunAgent(
      JSON.stringify({
        selectedLocal: [
          { name: "tdd", confidence: 91, reason: "The local TDD skill already fits implementation work." },
        ],
        selectedExternal: [
          {
            id: "vercel-labs/agent-skills@vercel-react-best-practices",
            confidence: 89,
            reason: "The repo uses React and this adds concrete performance guidance not covered locally.",
          },
        ],
      }),
    );
    const execSafeFn = vi.fn(
      async () => `
◇  Available Skills
│
│    vercel-react-best-practices
│
│      React and Next.js performance optimisation guidance.
│
└  Use --skill <name> to install specific skills
`,
    );
    const pctx = {
      ...mockPipelineAgentRuntime({ cwd: "/repo", runAgentFn }),
      execSafeFn,
    };

    const judged = await judgeSkillRecommendationReport(
      {
        command: "implement",
        rootsScanned: [],
        diagnostics: [],
        providerDiagnostics: [],
        provider: "skills.sh",
        discoveredSkills: [
          {
            name: "tdd",
            description: "Test-driven development guidance for building features.",
            filePath: "/repo/packages/dev/skills/tdd/SKILL.md",
            baseDir: "/repo/packages/dev/skills/tdd",
            disableModelInvocation: false,
            root: { path: "/repo/packages/dev/skills", scope: "project", harness: "pi", distance: 2, precedence: 100 },
          },
        ],
        duplicates: [],
        repoRoot: "/repo",
        changedFiles: [],
        focusPaths: ["/repo"],
        signals: [],
        selectedSkills: [],
        searchQueries: [{ query: "react", weight: 9, reasons: [] }],
        recommendedSkills: [
          {
            id: "vercel-labs/agent-skills@vercel-react-best-practices",
            slug: "vercel-react-best-practices",
            repository: "vercel-labs/agent-skills",
            url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
            installs: 229800,
            installsLabel: "229.8K installs",
            matchedQueries: ["react"],
            provider: "skills.sh",
            installCommand: "npx skills add vercel-labs/agent-skills@vercel-react-best-practices",
            score: 20,
            reasons: ["Matched skills.sh queries: react"],
          },
        ],
        skippedInstalledSkillNames: [],
      },
      pctx,
    );

    expect(execSafeFn).toHaveBeenCalledOnce();
    expect(judged.report.selectedSkills.map((skill) => skill.name)).toEqual(["tdd"]);
    expect(judged.report.recommendedSkills[0]?.description).toBe(
      "React and Next.js performance optimisation guidance.",
    );
    expect(judged.report.recommendedSkills[0]?.judgement?.confidence).toBe(89);
  });
});
