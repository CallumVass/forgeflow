import type { LambdaCandidate } from "../candidate.js";

const STOPWORDS = new Set([
  "api",
  "bin",
  "delete",
  "dev",
  "function",
  "generated",
  "get",
  "handler",
  "handlers",
  "http",
  "infra",
  "lambda",
  "main",
  "patch",
  "post",
  "prod",
  "publish",
  "put",
  "release",
  "src",
  "staging",
  "test",
  "tests",
  "uat",
  "update",
]);

export function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function singularise(token: string): string | undefined {
  if (token.length <= 4) return undefined;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("sses")) return undefined;
  if (token.endsWith("s")) return token.slice(0, -1);
  return undefined;
}

export function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

export function deriveSearchTerms(candidate: LambdaCandidate): string[] {
  const raw = [
    candidate.constructId,
    candidate.functionName,
    candidate.className,
    candidate.variableName,
    candidate.handler,
    candidate.entry,
    candidate.codePath,
    candidate.file,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const terms = new Set<string>();
  for (const value of raw) {
    const parts = splitIdentifier(value);
    const filtered = parts.filter((part) => part.length >= 3 && !STOPWORDS.has(part));
    for (const part of filtered) {
      terms.add(part);
      const singular = singularise(part);
      if (singular) terms.add(singular);
    }
    const joined = filtered.join("");
    if (joined.length >= 4) terms.add(joined);
  }

  return Array.from(terms).slice(0, 8);
}

export function buildIdentifierCandidates(candidate: LambdaCandidate): string[] {
  const raw = [
    candidate.constructId,
    candidate.functionName,
    candidate.className,
    candidate.variableName,
    candidate.handler,
    candidate.entry,
    candidate.codePath,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const identifiers = new Set<string>(raw);
  for (const value of raw) {
    const tokens = splitIdentifier(value).filter((part) => part.length >= 2 && !STOPWORDS.has(part));
    if (tokens.length > 0) identifiers.add(tokens.join(""));
    if (tokens.length > 1) identifiers.add(tokens.join("-"));
  }

  return Array.from(identifiers);
}

export function buildWildcardIdentifierPatterns(candidate: LambdaCandidate): string[] {
  const raw = [candidate.constructId, candidate.functionName, candidate.className, candidate.variableName].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  const patterns = new Set<string>();
  for (const value of raw) {
    const tokens = splitIdentifier(value).filter((part) => part.length >= 2 && !STOPWORDS.has(part));
    if (tokens.length === 0) continue;

    patterns.add(`*${tokens.join("*")}*`);
    patterns.add(`*${tokens.join("")}*`);
    if (tokens.length >= 2) patterns.add(`*${tokens[0]}*${tokens[tokens.length - 1]}*`);
  }

  return Array.from(patterns).slice(0, 6);
}
