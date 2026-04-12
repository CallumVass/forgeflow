import { describe, expect, it } from "vitest";
import type { SkillSignal } from "../types.js";
import { buildSkillSearchQueries } from "./search-queries.js";

describe("buildSkillSearchQueries", () => {
  it("keeps repo-aware queries, adds stage variants, and falls back to issue text when repo signals are not searchable", () => {
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

    const fallbackQueries = buildSkillSearchQueries(
      [
        {
          kind: "keyword",
          value: "ui",
          reason: "issue keyword",
          weight: 1,
          aliases: ["ui"],
        },
      ],
      "implement",
      "Need a Vitest helper for review prompts",
    );

    expect(fallbackQueries.map((query) => query.query)).toContain("vitest helper");
  });
});
