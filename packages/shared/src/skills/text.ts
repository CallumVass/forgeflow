const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "build",
  "by",
  "create",
  "for",
  "from",
  "how",
  "i",
  "if",
  "implement",
  "in",
  "into",
  "is",
  "it",
  "make",
  "need",
  "of",
  "on",
  "or",
  "project",
  "review",
  "scan",
  "should",
  "some",
  "that",
  "the",
  "this",
  "to",
  "update",
  "use",
  "using",
  "want",
  "we",
  "what",
  "with",
  "work",
]);

export function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function condensed(value: string): string {
  return normaliseText(value).replace(/\s+/g, "");
}

export function containsAlias(haystack: string, alias: string): boolean {
  if (!alias) return false;
  const normalHaystack = normaliseText(haystack);
  const normalAlias = normaliseText(alias);
  if (!normalAlias) return false;
  if (normalHaystack.includes(normalAlias)) return true;
  return condensed(haystack).includes(condensed(alias));
}

export function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

function splitCompoundWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[@/._-]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function addAliasVariants(target: Set<string>, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  target.add(trimmed);
  target.add(trimmed.toLowerCase());
  target.add(trimmed.replace(/[._/]+/g, "-"));
  target.add(trimmed.replace(/[._/-]+/g, " "));
}

export function aliasesForTerm(term: string): string[] {
  const raw = term.trim();
  if (!raw) return [];

  const aliases = new Set<string>();
  addAliasVariants(aliases, raw);

  const withoutScope = raw.replace(/^@([^/]+)\//, "$1/");
  addAliasVariants(aliases, withoutScope);

  const words = splitCompoundWords(raw);
  if (words.length > 0) {
    addAliasVariants(aliases, words.join(" "));
    addAliasVariants(aliases, words.join("-"));
    addAliasVariants(aliases, words.join(""));

    const maxWindow = Math.min(3, words.length);
    for (let size = 1; size <= maxWindow; size++) {
      for (let start = 0; start + size <= words.length; start++) {
        const window = words.slice(start, start + size);
        addAliasVariants(aliases, window.join(" "));
        addAliasVariants(aliases, window.join("-"));
        addAliasVariants(aliases, window.join(""));
      }
    }
  }

  if (words.length >= 3) {
    addAliasVariants(aliases, `${words[0]} ${words[words.length - 1]}`);
    addAliasVariants(aliases, `${words[0]}-${words[words.length - 1]}`);
    addAliasVariants(aliases, `${words[0]}${words[words.length - 1]}`);
  }

  if ((raw.includes("/") || raw.includes(".")) && words.length > 2) {
    const suffixWords = words.slice(1);
    addAliasVariants(aliases, suffixWords.join(" "));
    addAliasVariants(aliases, suffixWords.join("-"));
    addAliasVariants(aliases, suffixWords.join(""));
  }

  return uniqueStrings(Array.from(aliases).filter((alias) => condensed(alias).length >= 4));
}

function significantWords(text: string): string[] {
  return normaliseText(text)
    .split(" ")
    .filter((word) => word.length >= 3)
    .filter((word) => !STOP_WORDS.has(word));
}

export function extractSearchPhrases(text: string, maxPhrases = 24): string[] {
  const words = significantWords(text);
  const phrases: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word) phrases.push(word);
    const bigram = words.slice(i, i + 2).join(" ");
    if (bigram.split(" ").length === 2) phrases.push(bigram);
    const trigram = words.slice(i, i + 3).join(" ");
    if (trigram.split(" ").length === 3) phrases.push(trigram);
  }

  return uniqueStrings(phrases).slice(0, maxPhrases);
}
