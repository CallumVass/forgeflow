import * as path from "node:path";
import type { PipelineContext } from "../pipeline.js";
import { detectSkillSignals } from "./detectors/index.js";
import { scanRepository } from "./inventory.js";
import { selectSkills } from "./matcher.js";
import { discoverSkillLandscape } from "./roots.js";
import { aliasesForTerm, containsAlias, extractSearchPhrases, normaliseText, uniqueStrings } from "./text.js";
import type {
  ExternalSkillCandidate,
  QueriedExternalSkillCandidate,
  RecommendedExternalSkill,
  SkillCommand,
  SkillRecommendationProvider,
  SkillRecommendationProviderResult,
  SkillRecommendationReport,
  SkillSearchQuery,
  SkillSelectionInput,
  SkillSignal,
} from "./types.js";

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

const STAGE_QUERY_SUFFIX: Partial<Record<SkillCommand, string>> = {
  review: "review",
  "review-lite": "review",
  architecture: "architecture",
};

const DEFAULT_RECOMMENDATION_LIMIT = 8;

function stripAnsi(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const current = value[index];
    if (current === "\u001b" && value[index + 1] === "[") {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) break;
        index++;
      }
      continue;
    }
    out += current;
  }
  return out;
}

function parseCompactNumber(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
  const base = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

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

function skillSlugFromId(id: string): string {
  const at = id.indexOf("@");
  return at >= 0 ? id.slice(at + 1) : id;
}

function candidateKey(value: string): string {
  return normaliseText(value).replace(/\s+/g, "");
}

export function parseSkillsFindOutput(output: string): ExternalSkillCandidate[] {
  const lines = stripAnsi(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.some((line) => line.startsWith('No skills found for "'))) return [];

  const candidates: ExternalSkillCandidate[] = [];
  let pending: ExternalSkillCandidate | undefined;

  for (const line of lines) {
    if (line.startsWith("Install with")) continue;
    if (line.startsWith("└ ")) {
      if (pending) {
        candidates.push({ ...pending, url: line.replace(/^└\s*/, "").trim() });
        pending = undefined;
      }
      continue;
    }

    const match = line.match(/^(\S+?)(?:\s+([0-9][0-9.,]*\s*[KMB]?)\s+installs)?$/i);
    const id = match?.[1];
    if (!id) continue;
    pending = {
      id,
      slug: skillSlugFromId(id),
      url: "",
      installs: parseCompactNumber(match?.[2]?.replace(/,/g, "").replace(/\s+/g, "")),
      installsLabel: match?.[2] ? `${match[2].trim()} installs` : undefined,
    };
  }

  if (pending) candidates.push(pending);
  return candidates;
}

export function createSkillsCliRecommendationProvider(
  execSafeFn: PipelineContext["execSafeFn"],
  cwd: string,
): SkillRecommendationProvider {
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
        candidates: Array.from(candidatesById.values()),
      };
    },
  };
}

function buildRecommendedExternalSkill(
  candidate: QueriedExternalSkillCandidate,
  signals: SkillSignal[],
  queryWeights: Map<string, number>,
  command: SkillCommand,
  provider: string,
): RecommendedExternalSkill | undefined {
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

export async function buildSkillRecommendationReport(
  cwd: string,
  config: PipelineContext["skillsConfig"],
  input: SkillSelectionInput,
  provider: SkillRecommendationProvider,
  maxRecommended = DEFAULT_RECOMMENDATION_LIMIT,
): Promise<SkillRecommendationReport> {
  const landscape = await discoverSkillLandscape(cwd, config);
  const inventory = scanRepository(cwd);
  const analysed = detectSkillSignals(cwd, inventory, input);
  const selectedSkills = config.enabled
    ? selectSkills(landscape.discoveredSkills, analysed.signals, input.maxSelected ?? config.maxSelected)
    : [];
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
  const recommendedSkills = providerResult.candidates
    .map((candidate) =>
      buildRecommendedExternalSkill(candidate, analysed.signals, queryWeights, input.command, providerResult.provider),
    )
    .filter((candidate): candidate is RecommendedExternalSkill => Boolean(candidate))
    .filter((candidate) => {
      const installed = installedKeys.has(candidateKey(candidate.slug));
      if (installed) skippedInstalled.add(candidate.slug);
      return !installed;
    })
    .sort((a, b) => b.score - a.score || (b.installs ?? 0) - (a.installs ?? 0) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, maxRecommended));

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

function formatInstallCount(skill: RecommendedExternalSkill): string {
  return skill.installsLabel ?? (skill.installs ? `${skill.installs.toLocaleString()} installs` : "installs unknown");
}

export function renderSkillRecommendationReport(report: SkillRecommendationReport): string {
  const lines: string[] = [
    `## Skill recommendations for ${report.command}`,
    "",
    `Repo root: ${report.repoRoot}`,
    `Relevant installed skills: ${report.selectedSkills.length}`,
    `Missing recommendations: ${report.recommendedSkills.length}`,
    `Recommendation source: ${report.provider}`,
  ];

  if (report.rootsScanned.length > 0) {
    lines.push("", "### Scanned roots");
    for (const root of report.rootsScanned) {
      const rel = path.relative(report.repoRoot, root.path);
      lines.push(`- ${rel && !rel.startsWith("..") ? rel : root.path} (${root.scope}, ${root.harness})`);
    }
  }

  if (report.changedFiles.length > 0) {
    lines.push("", "### Changed files");
    for (const file of report.changedFiles) lines.push(`- ${path.relative(report.repoRoot, file) || file}`);
  }

  if (report.signals.length > 0) {
    lines.push("", "### Repo signals");
    for (const signal of report.signals) lines.push(`- ${signal.reason}`);
  }

  if (report.selectedSkills.length > 0) {
    lines.push("", "### Relevant installed skills");
    for (const skill of report.selectedSkills) {
      lines.push(`- ${skill.name} — ${path.relative(report.repoRoot, skill.filePath) || skill.filePath}`);
      for (const reason of skill.reasons) lines.push(`  - ${reason}`);
    }
  }

  if (report.searchQueries.length > 0) {
    lines.push("", `### ${report.provider} queries`);
    for (const query of report.searchQueries) {
      lines.push(`- ${query.query}`);
      for (const reason of query.reasons.slice(0, 2)) lines.push(`  - ${reason}`);
    }
  }

  lines.push("", "### Missing recommended skills");
  if (report.recommendedSkills.length === 0) {
    lines.push("- No missing skills matched the current repo signals.");
  } else {
    for (const skill of report.recommendedSkills) {
      lines.push(`- ${skill.id} — ${formatInstallCount(skill)}`);
      lines.push(`  - Install: ${skill.installCommand}`);
      if (skill.url) lines.push(`  - URL: ${skill.url}`);
      for (const reason of skill.reasons) lines.push(`  - ${reason}`);
    }
  }

  if (report.skippedInstalledSkillNames.length > 0) {
    lines.push("", "### Already installed matches omitted from recommendations");
    for (const name of report.skippedInstalledSkillNames) lines.push(`- ${name}`);
  }

  if (report.duplicates.length > 0) {
    lines.push("", "### Name collisions");
    for (const dup of report.duplicates) {
      lines.push(`- ${dup.name}: kept ${dup.chosen.filePath}`);
      for (const ignored of dup.ignored) lines.push(`  - ignored ${ignored.filePath}`);
    }
  }

  if (report.providerDiagnostics.length > 0) {
    lines.push("", `### ${report.provider} diagnostics`);
    for (const diagnostic of report.providerDiagnostics) lines.push(`- ${diagnostic}`);
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "### Diagnostics");
    for (const diagnostic of report.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return lines.join("\n");
}
