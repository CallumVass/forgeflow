import { filterIdentifierTokens, uniqueStrings } from "./candidate-identifiers.js";
import type { TagFilter } from "./contracts.js";

interface MetricContextSummary {
  indexedTags: Record<string, string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIndexedTagsFromText(text: string): Record<string, string[]> {
  const tags: Record<string, string[]> = {};
  const lines = text.split(/\r?\n/);
  let inIndexedTags = false;
  let currentTag: string | undefined;

  for (const line of lines) {
    if (!inIndexedTags) {
      if (/indexed_tags:\s*$/.test(line)) inIndexedTags = true;
      continue;
    }

    if (/^\S/.test(line) || /^\s{0,3}[A-Za-z0-9_.-]+:\s*$/.test(line)) break;

    const tag = line.match(/^\s+([A-Za-z0-9_.-]+):\s*$/)?.[1];
    if (tag) {
      currentTag = tag;
      tags[tag] = tags[tag] ?? [];
      continue;
    }

    const value = line.match(/^\s+-\s*(.+?)\s*$/)?.[1];
    if (currentTag && value) tags[currentTag]?.push(value.replace(/^"|"$/g, ""));
  }

  return tags;
}

export function extractMetricContext(parsed: unknown): MetricContextSummary | undefined {
  if (isRecord(parsed) && isRecord(parsed.tags_data) && isRecord(parsed.tags_data.indexed_tags)) {
    const rawIndexedTags = parsed.tags_data.indexed_tags as Record<string, unknown>;
    const indexedTags = Object.fromEntries(
      Object.entries(rawIndexedTags)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [
          key,
          (value as unknown[]).filter((entry): entry is string => typeof entry === "string"),
        ]),
    );
    return { indexedTags };
  }

  if (typeof parsed === "string") {
    const indexedTags = parseIndexedTagsFromText(parsed);
    if (Object.keys(indexedTags).length > 0) return { indexedTags };
  }

  return undefined;
}

function normaliseValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesOrderedTokenSequence(valueNorm: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  let cursor = 0;
  for (const token of tokens) {
    const index = valueNorm.indexOf(token, cursor);
    if (index < 0) return false;
    cursor = index + token.length;
  }

  return true;
}

export function findBestTagMatch(
  indexedTags: Record<string, string[]>,
  keys: string[],
  candidates: string[],
): TagFilter | undefined {
  const wanted = uniqueStrings(candidates)
    .map((candidate) => ({
      raw: candidate,
      norm: normaliseValue(candidate),
      tokens: filterIdentifierTokens(candidate),
    }))
    .filter((candidate) => candidate.norm.length > 0 || candidate.tokens.length > 0);

  let best: { filter: TagFilter; score: number } | undefined;
  for (const key of keys) {
    const values = indexedTags[key] ?? [];
    for (const value of values) {
      const valueNorm = normaliseValue(value);
      for (const candidate of wanted) {
        let score = -1;
        if (value.toLowerCase() === candidate.raw.toLowerCase()) score = 100;
        else if (candidate.norm.length > 0 && valueNorm === candidate.norm) score = 95;
        else if (candidate.norm.length >= 4 && valueNorm.includes(candidate.norm)) score = 70;
        else if (candidate.norm.length >= 4 && candidate.norm.includes(valueNorm)) score = 60;
        else if (candidate.tokens.length >= 2 && matchesOrderedTokenSequence(valueNorm, candidate.tokens)) score = 65;
        if (!best || score > best.score) best = { filter: { key, value }, score };
      }
    }
  }

  return best?.score && best.score > 0 ? best.filter : undefined;
}

export function chooseServiceHint(indexedTags: Record<string, string[]>): string | undefined {
  const services = indexedTags.service?.filter((value) => value.trim().length > 0) ?? [];
  if (services.length === 1) return services[0];
  return undefined;
}
