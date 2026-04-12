import { describe, expect, it } from "vitest";
import { parseSkillsFindOutput } from "./skills-find-parser.js";

describe("parseSkillsFindOutput", () => {
  it("strips ANSI output, parses install counts and URLs, and ignores no-result output", () => {
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
    expect(parseSkillsFindOutput('No skills found for "tailwind review"')).toEqual([]);
  });
});
