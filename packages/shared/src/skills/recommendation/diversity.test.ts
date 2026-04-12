import { describe, expect, it } from "vitest";
import type { RecommendedExternalSkill, SkillSignal } from "../types.js";
import { diversifyRecommendedSkills, familyKeyForRecommendedSkill } from "./diversity.js";

const signals: SkillSignal[] = [
  {
    kind: "dependency",
    value: "vitest",
    reason: "package.json: dependency vitest",
    weight: 5,
    aliases: ["vitest"],
  },
  {
    kind: "dependency",
    value: "react",
    reason: "package.json: dependency react",
    weight: 5,
    aliases: ["react"],
  },
  {
    kind: "dependency",
    value: "@testing-library/react",
    reason: "package.json: dependency @testing-library/react",
    weight: 4,
    aliases: ["@testing-library/react", "testing-library/react", "testing library react"],
  },
];

function recommendedSkill(overrides: Partial<RecommendedExternalSkill>): RecommendedExternalSkill {
  return {
    id: "community/skills@example",
    slug: "example",
    url: "https://skills.sh/community/skills/example",
    installs: 100,
    installsLabel: "100 installs",
    matchedQueries: [],
    provider: "skills.sh",
    installCommand: "npx skills add community/skills@example",
    score: 10,
    reasons: [],
    ...overrides,
  };
}

describe("skill recommendation diversity", () => {
  it("groups narrow variants under the same library family", () => {
    const queryWeights = new Map([
      ["vitest", 10],
      ["react", 9],
      ["testing library react", 8],
    ]);

    expect(
      familyKeyForRecommendedSkill(
        recommendedSkill({
          id: "community/skills@vitest-mocking",
          slug: "vitest-mocking",
          matchedQueries: ["vitest"],
        }),
        signals,
        queryWeights,
      ),
    ).toBe("vitest");

    expect(
      familyKeyForRecommendedSkill(
        recommendedSkill({
          id: "community/skills@vercel-react-best-practices",
          slug: "vercel-react-best-practices",
          matchedQueries: ["react"],
        }),
        signals,
        queryWeights,
      ),
    ).toBe("react");

    expect(
      familyKeyForRecommendedSkill(
        recommendedSkill({
          id: "community/skills@testing-library-react",
          slug: "testing-library-react",
          matchedQueries: ["testing library react"],
        }),
        signals,
        queryWeights,
      ),
    ).toBe("testing library react");
  });

  it("keeps only the top ranked skill per family by default", () => {
    const queryWeights = new Map([
      ["vitest", 10],
      ["react", 9],
    ]);
    const skills = diversifyRecommendedSkills(
      [
        recommendedSkill({
          id: "community/skills@vitest-mocking",
          slug: "vitest-mocking",
          matchedQueries: ["vitest"],
          score: 30,
        }),
        recommendedSkill({
          id: "community/skills@vitest-config",
          slug: "vitest-config",
          matchedQueries: ["vitest"],
          score: 25,
        }),
        recommendedSkill({
          id: "community/skills@react",
          slug: "react",
          matchedQueries: ["react"],
          score: 20,
        }),
      ],
      signals,
      queryWeights,
      5,
    );

    expect(skills.map((skill) => skill.id)).toEqual(["community/skills@vitest-mocking", "community/skills@react"]);
  });
});
