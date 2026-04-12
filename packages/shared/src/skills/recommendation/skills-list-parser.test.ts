import { describe, expect, it, vi } from "vitest";
import { enrichSkillsCliCandidates } from "./enrichment.js";
import { parseSkillsListOutput } from "./skills-list-parser.js";

describe("parseSkillsListOutput", () => {
  it("parses skill names and descriptions from `skills add --list` output", () => {
    const output = `
◇  Available Skills
│
│    vercel-react-best-practices
│
│      React and Next.js performance optimisation guidance.
│
│    web-design-guidelines
│
│      Review UI code for interface guideline compliance.
│
└  Use --skill <name> to install specific skills
`;

    expect(parseSkillsListOutput(output)).toEqual([
      {
        slug: "vercel-react-best-practices",
        description: "React and Next.js performance optimisation guidance.",
      },
      {
        slug: "web-design-guidelines",
        description: "Review UI code for interface guideline compliance.",
      },
    ]);
  });
});

describe("enrichSkillsCliCandidates", () => {
  it("hydrates candidate descriptions by repository listing", async () => {
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

    const [candidate] = await enrichSkillsCliCandidates(
      [
        {
          id: "vercel-labs/agent-skills@vercel-react-best-practices",
          slug: "vercel-react-best-practices",
          repository: "vercel-labs/agent-skills",
          url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
          installs: 229800,
          installsLabel: "229.8K installs",
        },
      ],
      execSafeFn,
      "/repo",
    );

    expect(execSafeFn).toHaveBeenCalledOnce();
    expect(candidate?.description).toBe("React and Next.js performance optimisation guidance.");
  });
});
