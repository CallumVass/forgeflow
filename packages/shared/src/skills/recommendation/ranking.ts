import { containsAlias, normaliseText, uniqueStrings } from "../text.js";
import type { QueriedExternalSkillCandidate, RecommendedExternalSkill, SkillCommand, SkillSignal } from "../types.js";

const STAGE_QUERY_SUFFIX: Partial<Record<SkillCommand, string>> = {
  review: "review",
  "review-lite": "review",
  architecture: "architecture",
};

export function scoreRecommendedExternalSkill(input: {
  candidate: QueriedExternalSkillCandidate;
  signals: SkillSignal[];
  queryWeights: Map<string, number>;
  command: SkillCommand;
  provider: string;
}): RecommendedExternalSkill | undefined {
  const { candidate, signals, queryWeights, command, provider } = input;
  let score = 0;
  const reasons: string[] = [];
  const slugText = normaliseText(candidate.slug);
  const idText = normaliseText(candidate.id);
  const urlText = normaliseText(candidate.url);

  for (const signal of signals) {
    let matched = false;
    for (const alias of signal.aliases) {
      if (containsAlias(slugText, alias)) {
        score += signal.weight * 5;
        matched = true;
        break;
      }
      if (containsAlias(idText, alias)) {
        score += signal.weight * 4;
        matched = true;
        break;
      }
      if (containsAlias(urlText, alias)) {
        score += signal.weight * 3;
        matched = true;
        break;
      }
    }
    if (matched) reasons.push(signal.reason);
  }

  for (const query of candidate.matchedQueries) {
    score += (queryWeights.get(query) ?? 1) * 2;
  }
  if (candidate.matchedQueries.length > 1) score += candidate.matchedQueries.length * 2;
  if (candidate.installs) score += Math.min(12, Math.log10(candidate.installs + 1) * 3);

  const stageHint = STAGE_QUERY_SUFFIX[command];
  if (stageHint && containsAlias(slugText, stageHint)) score += 3;
  if (score <= 0) return undefined;

  const queryReason = `Matched skills.sh queries: ${candidate.matchedQueries.join(", ")}`;
  const installReason = candidate.installsLabel ? `Popularity: ${candidate.installsLabel}` : "Found via skills.sh";
  return {
    ...candidate,
    provider,
    installCommand: `npx skills add ${candidate.id}`,
    score,
    reasons: uniqueStrings([...reasons, queryReason, installReason]).slice(0, 5),
  };
}
