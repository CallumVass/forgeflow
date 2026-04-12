import type { ExecFn } from "../../io/index.js";
import { normaliseText, uniqueStrings } from "../text.js";
import type {
  ExternalSkillCandidate,
  QueriedExternalSkillCandidate,
  SkillRecommendationProvider,
  SkillRecommendationProviderResult,
} from "../types.js";
import { parseSkillsFindOutput } from "./skills-find-parser.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sortCandidates(candidates: QueriedExternalSkillCandidate[]): QueriedExternalSkillCandidate[] {
  return candidates.sort(
    (a, b) =>
      (b.installs ?? 0) - (a.installs ?? 0) ||
      normaliseText(a.id).localeCompare(normaliseText(b.id)) ||
      a.id.localeCompare(b.id),
  );
}

export function createSkillsCliRecommendationProvider(execSafeFn: ExecFn, cwd: string): SkillRecommendationProvider {
  const cache = new Map<string, ExternalSkillCandidate[]>();
  const providerName = "skills.sh";

  return {
    name: providerName,
    async search(queries): Promise<SkillRecommendationProviderResult> {
      const diagnostics: string[] = [];
      const candidatesById = new Map<string, QueriedExternalSkillCandidate>();

      for (const query of queries) {
        let parsed = cache.get(query.query);
        if (!parsed) {
          const output = await execSafeFn(`npx --yes skills find ${shellQuote(query.query)}`, cwd);
          if (!output) {
            diagnostics.push(`skills.sh search failed for query: ${query.query}`);
            cache.set(query.query, []);
            continue;
          }
          parsed = parseSkillsFindOutput(output);
          cache.set(query.query, parsed);
        }

        for (const candidate of parsed) {
          const existing = candidatesById.get(candidate.id);
          if (existing) {
            existing.matchedQueries = uniqueStrings([...existing.matchedQueries, query.query]);
            continue;
          }
          candidatesById.set(candidate.id, {
            ...candidate,
            matchedQueries: [query.query],
          });
        }
      }

      return {
        provider: providerName,
        diagnostics,
        candidates: sortCandidates(Array.from(candidatesById.values())),
      };
    },
  };
}
