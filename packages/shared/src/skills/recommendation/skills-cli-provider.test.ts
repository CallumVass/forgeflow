import { describe, expect, it, vi } from "vitest";
import { createSkillsCliRecommendationProvider } from "./skills-cli-provider.js";

describe("createSkillsCliRecommendationProvider", () => {
  it("caches identical queries within one provider instance and merges duplicate candidate ids across query results", async () => {
    const execSafeFn = vi.fn(async (command: string) => {
      if (command.includes("react tailwind")) {
        return `
vercel-labs/agent-skills@vercel-react-best-practices 229.8K installs
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
community/skills@tailwind 1K installs
└ https://skills.sh/community/skills/tailwind
`;
      }

      return `
vercel-labs/agent-skills@vercel-react-best-practices 229.8K installs
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
`;
    });

    const provider = createSkillsCliRecommendationProvider(execSafeFn, "/repo");
    const result = await provider.search([
      { query: "react", weight: 10, reasons: [] },
      { query: "react", weight: 8, reasons: [] },
      { query: "react tailwind", weight: 7, reasons: [] },
    ]);

    expect(execSafeFn).toHaveBeenCalledTimes(2);
    expect(result.candidates).toEqual([
      {
        id: "vercel-labs/agent-skills@vercel-react-best-practices",
        slug: "vercel-react-best-practices",
        repository: "vercel-labs/agent-skills",
        url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
        installs: 229800,
        installsLabel: "229.8K installs",
        matchedQueries: ["react", "react tailwind"],
      },
      {
        id: "community/skills@tailwind",
        slug: "tailwind",
        repository: "community/skills",
        url: "https://skills.sh/community/skills/tailwind",
        installs: 1000,
        installsLabel: "1K installs",
        matchedQueries: ["react tailwind"],
      },
    ]);
  });
});
