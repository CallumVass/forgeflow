import { aliasesForTerm, containsAlias, normaliseText, uniqueStrings } from "../text.js";
import type { RecommendedExternalSkill, SkillSignal } from "../types.js";

const GENERIC_FAMILY_WORDS = new Set([
  "agent",
  "agents",
  "architecture",
  "best",
  "boilerplate",
  "cli",
  "code",
  "config",
  "configuration",
  "example",
  "examples",
  "guide",
  "guides",
  "helper",
  "helpers",
  "implementation",
  "implement",
  "patterns",
  "practice",
  "practices",
  "prompt",
  "prompts",
  "repo",
  "review",
  "scaffold",
  "setup",
  "skill",
  "skills",
  "starter",
  "template",
  "templates",
  "tool",
  "tools",
  "workflow",
  "workflows",
]);

function familyWords(value: string): string[] {
  return normaliseText(value)
    .split(" ")
    .filter((word) => word.length >= 3)
    .filter((word) => !GENERIC_FAMILY_WORDS.has(word));
}

function normaliseFamilyPhrase(value: string): string | undefined {
  const words = familyWords(value);
  if (words.length === 0 || words.length > 3) return undefined;
  return words.join(" ");
}

function familyPhraseVariants(value: string): string[] {
  return uniqueStrings([value, ...aliasesForTerm(value)])
    .map((variant) => normaliseFamilyPhrase(variant))
    .filter((variant): variant is string => Boolean(variant))
    .sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length || a.localeCompare(b));
}

function addPhraseScore(
  scores: Map<string, number>,
  skill: RecommendedExternalSkill,
  phrase: string,
  baseWeight: number,
): void {
  const candidateText = `${skill.slug} ${skill.id} ${skill.url}`;
  if (!containsAlias(candidateText, phrase)) return;

  const phraseWordCount = phrase.split(" ").length;
  const slugMatches = containsAlias(skill.slug, phrase);
  const score = baseWeight * 10 + phraseWordCount * 4 + (slugMatches ? 3 : 0);
  scores.set(phrase, Math.max(scores.get(phrase) ?? 0, score));
}

function fallbackFamily(skill: RecommendedExternalSkill): string {
  return familyWords(`${skill.slug} ${skill.id}`)[0] ?? normaliseText(skill.slug || skill.id);
}

export function familyKeyForRecommendedSkill(
  skill: RecommendedExternalSkill,
  signals: SkillSignal[],
  queryWeights: Map<string, number>,
): string {
  const scores = new Map<string, number>();

  for (const query of skill.matchedQueries) {
    const queryWeight = queryWeights.get(query) ?? 1;
    for (const phrase of familyPhraseVariants(query)) {
      addPhraseScore(scores, skill, phrase, queryWeight);
    }
  }

  for (const signal of signals) {
    for (const phrase of uniqueStrings(
      [signal.value, ...signal.aliases].flatMap((value) => familyPhraseVariants(value)),
    )) {
      addPhraseScore(scores, skill, phrase, signal.weight);
    }
  }

  if (scores.size === 0) return fallbackFamily(skill);

  return (
    Array.from(scores.entries()).sort(
      ([leftPhrase, leftScore], [rightPhrase, rightScore]) =>
        rightScore - leftScore ||
        rightPhrase.split(" ").length - leftPhrase.split(" ").length ||
        rightPhrase.length - leftPhrase.length ||
        leftPhrase.localeCompare(rightPhrase),
    )[0]?.[0] ?? fallbackFamily(skill)
  );
}

export function diversifyRecommendedSkills(
  skills: RecommendedExternalSkill[],
  signals: SkillSignal[],
  queryWeights: Map<string, number>,
  maxRecommended: number,
  maxPerFamily = 1,
): RecommendedExternalSkill[] {
  if (maxRecommended <= 0) return [];

  const familyCounts = new Map<string, number>();
  const diversified: RecommendedExternalSkill[] = [];

  for (const skill of skills) {
    const family = familyKeyForRecommendedSkill(skill, signals, queryWeights);
    const count = familyCounts.get(family) ?? 0;
    if (count >= Math.max(1, maxPerFamily)) continue;
    familyCounts.set(family, count + 1);
    diversified.push(skill);
    if (diversified.length >= Math.max(0, maxRecommended)) break;
  }

  return diversified;
}
