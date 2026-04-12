import { aliasesForTerm, extractSearchPhrases, normaliseText, uniqueStrings } from "../text.js";
import type { SkillCommand, SkillSearchQuery, SkillSignal } from "../types.js";
import { STAGE_QUERY_SUFFIX } from "./stage-query-suffix.js";

const GENERIC_QUERY_WORDS = new Set([
  "app",
  "apps",
  "application",
  "client",
  "clients",
  "cloud",
  "code",
  "component",
  "components",
  "config",
  "configuration",
  "core",
  "framework",
  "frameworks",
  "frontend",
  "backend",
  "fullstack",
  "library",
  "libraries",
  "module",
  "modules",
  "monorepo",
  "package",
  "packages",
  "project",
  "projects",
  "sdk",
  "server",
  "service",
  "services",
  "stack",
  "tool",
  "tools",
  "ui",
  "web",
  "workspace",
]);

function queryWordCount(value: string): number {
  return normaliseText(value).split(" ").filter(Boolean).length;
}

function isUsefulQuery(value: string): boolean {
  const words = normaliseText(value).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  if (words.some((word) => word.length < 3)) return false;
  return words.some((word) => !GENERIC_QUERY_WORDS.has(word));
}

function scoreQueryVariant(value: string): number {
  const words = normaliseText(value).split(" ").filter(Boolean);
  let score = 0;
  if (words.length === 2) score += 4;
  else if (words.length === 1) score += 3;
  else if (words.length === 3) score += 2;
  score += words.filter((word) => !GENERIC_QUERY_WORDS.has(word)).length * 2;
  score -= value.includes("/") || value.includes("@") ? 2 : 0;
  return score;
}

function preferredQueryTerms(value: string): string[] {
  return uniqueStrings(
    aliasesForTerm(value)
      .map((alias) => normaliseText(alias))
      .filter(isUsefulQuery)
      .sort((a, b) => scoreQueryVariant(b) - scoreQueryVariant(a) || a.localeCompare(b)),
  ).slice(0, 3);
}

function mergeQuery(
  queries: Map<string, { weight: number; reasons: Set<string> }>,
  query: string,
  weight: number,
  reasons: string[],
): void {
  const normalised = normaliseText(query);
  if (!normalised) return;
  const entry = queries.get(normalised) ?? { weight: 0, reasons: new Set<string>() };
  entry.weight = Math.max(entry.weight, weight);
  for (const reason of reasons) {
    if (reason) entry.reasons.add(reason);
  }
  queries.set(normalised, entry);
}

export function buildSkillSearchQueries(
  signals: SkillSignal[],
  command: SkillCommand,
  issueText?: string,
  maxQueries = 8,
): SkillSearchQuery[] {
  const queries = new Map<string, { weight: number; reasons: Set<string> }>();
  const queryWeights = new Map<string, number>();
  const primaryTerms: string[] = [];
  const searchSignals = signals.filter((signal) => signal.kind !== "keyword" && signal.kind !== "file") || [];
  const weightedSignals = (searchSignals.length > 0 ? searchSignals : signals)
    .slice()
    .sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value));

  for (const signal of weightedSignals) {
    const terms = preferredQueryTerms(signal.value).slice(0, 2);
    for (const [index, term] of terms.entries()) {
      const termWeight = signal.weight * 3 - index;
      mergeQuery(queries, term, termWeight, [signal.reason]);
      queryWeights.set(term, Math.max(queryWeights.get(term) ?? 0, termWeight));
      if (index === 0) primaryTerms.push(term);
    }
  }

  const uniquePrimaryTerms = uniqueStrings(primaryTerms).slice(0, 4);
  for (let i = 0; i < uniquePrimaryTerms.length; i++) {
    for (let j = i + 1; j < uniquePrimaryTerms.length; j++) {
      if (queries.size >= maxQueries * 2) break;
      const left = uniquePrimaryTerms[i];
      const right = uniquePrimaryTerms[j];
      if (!left || !right) continue;
      const leftWords = new Set(normaliseText(left).split(" ").filter(Boolean));
      const rightWords = normaliseText(right).split(" ").filter(Boolean);
      if (rightWords.some((word) => leftWords.has(word))) continue;
      const combined = `${left} ${right}`;
      mergeQuery(queries, combined, (queryWeights.get(left) ?? 1) + (queryWeights.get(right) ?? 1) + 1, [
        `Combined repo signals: ${left} + ${right}`,
      ]);
    }
  }

  const stageSuffix = STAGE_QUERY_SUFFIX[command];
  if (stageSuffix) {
    for (const term of uniquePrimaryTerms.slice(0, 2)) {
      mergeQuery(queries, `${term} ${stageSuffix}`, (queryWeights.get(term) ?? 1) + 1, [
        `${term}: relevant for ${command}`,
      ]);
    }
  }

  if (queries.size === 0 && issueText) {
    for (const phrase of extractSearchPhrases(issueText, maxQueries)) {
      if (!isUsefulQuery(phrase)) continue;
      mergeQuery(queries, phrase, 1, [`Fallback from issue text: ${issueText}`]);
    }
  }

  return Array.from(queries.entries())
    .map(([query, value]) => ({
      query,
      weight: value.weight,
      reasons: Array.from(value.reasons).slice(0, 3),
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight || queryWordCount(a.query) - queryWordCount(b.query) || a.query.localeCompare(b.query),
    )
    .slice(0, maxQueries);
}
