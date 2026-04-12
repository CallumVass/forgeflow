import type { SkillsConfig } from "../../config/forgeflow-config.js";
import { analyseSkillSelection } from "../analysis.js";
import { normaliseText } from "../text.js";
import type {
  RecommendedExternalSkill,
  SkillRecommendationProvider,
  SkillRecommendationProviderResult,
  SkillRecommendationReport,
  SkillSelectionInput,
} from "../types.js";
import { diversifyRecommendedSkills } from "./diversity.js";
import { scoreRecommendedExternalSkill } from "./ranking.js";
import { buildSkillSearchQueries } from "./search-queries.js";

const DEFAULT_RECOMMENDATION_LIMIT = 8;
const DEFAULT_RECOMMENDATION_FAMILY_LIMIT = 1;

function candidateKey(value: string): string {
  return normaliseText(value).replace(/\s+/g, "");
}

function sortRecommendedSkills(skills: RecommendedExternalSkill[]): RecommendedExternalSkill[] {
  return skills.sort((a, b) => b.score - a.score || (b.installs ?? 0) - (a.installs ?? 0) || a.id.localeCompare(b.id));
}

export async function buildSkillRecommendationReport(
  cwd: string,
  config: SkillsConfig,
  input: SkillSelectionInput,
  provider: SkillRecommendationProvider,
  maxRecommended = DEFAULT_RECOMMENDATION_LIMIT,
): Promise<SkillRecommendationReport> {
  const { landscape, analysed, selectedSkills } = await analyseSkillSelection(cwd, config, input);
  const searchQueries = buildSkillSearchQueries(analysed.signals, input.command, input.issueText);
  const installedKeys = new Set(landscape.discoveredSkills.map((skill) => candidateKey(skill.name)));
  const skippedInstalled = new Set<string>();

  let providerResult: SkillRecommendationProviderResult = {
    provider: provider.name,
    diagnostics: [],
    candidates: [],
  };

  if (searchQueries.length > 0) {
    providerResult = await provider.search(searchQueries);
  } else {
    providerResult.diagnostics.push("No strong repo signals were suitable for skills.sh search.");
  }

  const queryWeights = new Map(searchQueries.map((query) => [query.query, query.weight]));
  const rankedRecommendations = sortRecommendedSkills(
    providerResult.candidates
      .map((candidate) =>
        scoreRecommendedExternalSkill({
          candidate,
          signals: analysed.signals,
          queryWeights,
          command: input.command,
          provider: providerResult.provider,
        }),
      )
      .filter((candidate): candidate is RecommendedExternalSkill => Boolean(candidate))
      .filter((candidate) => {
        const installed = installedKeys.has(candidateKey(candidate.slug));
        if (installed) skippedInstalled.add(candidate.slug);
        return !installed;
      }),
  );

  const recommendedSkills = diversifyRecommendedSkills(
    rankedRecommendations,
    analysed.signals,
    queryWeights,
    maxRecommended,
    DEFAULT_RECOMMENDATION_FAMILY_LIMIT,
  );

  return {
    command: input.command,
    rootsScanned: landscape.rootsScanned,
    diagnostics: landscape.diagnostics,
    providerDiagnostics: providerResult.diagnostics,
    provider: providerResult.provider,
    discoveredSkills: landscape.discoveredSkills,
    duplicates: landscape.duplicates,
    repoRoot: analysed.repoRoot,
    changedFiles: analysed.changedFiles,
    focusPaths: analysed.focusPaths,
    signals: analysed.signals,
    selectedSkills,
    searchQueries,
    recommendedSkills,
    skippedInstalledSkillNames: Array.from(skippedInstalled).sort((a, b) => a.localeCompare(b)),
  };
}
