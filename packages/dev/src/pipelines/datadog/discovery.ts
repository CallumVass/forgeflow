import type { DatadogMcpSession } from "@callumvass/forgeflow-shared/datadog";
import { callDatadogMcpTool, parseDatadogMcpJson } from "@callumvass/forgeflow-shared/datadog";
import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import type { LambdaCandidate } from "./candidate.js";

export interface TagFilter {
  key: string;
  value: string;
}

export interface MetricQueryPlan {
  durationMetric: string;
  countMetric?: string;
  filters: TagFilter[];
  service?: string;
  score: number;
  provenance: string[];
}

interface MetricContextSummary {
  indexedTags: Record<string, string[]>;
}

const DEFAULT_METRIC_CANDIDATES = [
  "aws.lambda.enhanced.duration",
  "aws.lambda.duration",
  "aws.lambda.enhanced.runtime_duration",
];

const METRIC_KEYWORDS = /(?:duration|count|error|errors|latency|outcome)/i;
const DURATION_KEYWORDS = /(?:duration|latency|runtime_duration)/i;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseToolText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreTool(
  tool: Pick<DatadogMcpSession["tools"][number], "name" | "description">,
  requiredTerms: string[],
  optionalTerms: string[],
  requireOptionalMatch = false,
): number {
  const haystack = `${normaliseToolText(tool.name)} ${normaliseToolText(tool.description)}`.trim();
  if (!haystack) return -1;
  if (requiredTerms.some((term) => !haystack.includes(term))) return -1;

  const optionalMatches = optionalTerms.filter((term) => haystack.includes(term)).length;
  if (requireOptionalMatch && optionalMatches === 0) return -1;

  let score = 0;
  for (const term of requiredTerms) score += normaliseToolText(tool.name).includes(term) ? 5 : 2;
  for (const term of optionalTerms) {
    if (haystack.includes(term)) score += normaliseToolText(tool.name).includes(term) ? 3 : 1;
  }
  return score;
}

export function resolveDatadogTool(
  session: Pick<DatadogMcpSession, "tools" | "toolNames">,
  capability: "metricsQuery" | "logsSearch" | "metricsCatalog" | "metricContext" | "spansSearch",
): string | undefined {
  const exactAliases = {
    metricsQuery: ["get_datadog_metric", "datadog_get_datadog_metric", "query_datadog_metrics", "query-metrics"],
    logsSearch: ["search_datadog_logs", "datadog_search_datadog_logs", "search-logs"],
    metricsCatalog: ["search_datadog_metrics", "datadog_search_datadog_metrics", "list_datadog_metrics", "get-metrics"],
    metricContext: ["get_datadog_metric_context", "datadog_get_datadog_metric_context"],
    spansSearch: ["search_datadog_spans", "datadog_search_datadog_spans", "search-spans"],
  } as const;

  const heuristics = {
    metricsQuery: { requiredTerms: ["metric"], optionalTerms: ["query", "timeseries", "measure", "point", "value"] },
    logsSearch: { requiredTerms: ["log"], optionalTerms: ["search", "query", "events"] },
    metricsCatalog: { requiredTerms: ["metric"], optionalTerms: ["list", "catalog", "search", "discover"] },
    metricContext: { requiredTerms: ["metric"], optionalTerms: ["context", "tags", "indexed", "metadata"] },
    spansSearch: { requiredTerms: ["span"], optionalTerms: ["search", "trace", "apm"] },
  } as const;

  for (const alias of exactAliases[capability]) {
    if (session.toolNames.includes(alias)) return alias;
  }

  const heuristic = heuristics[capability];
  const requireOptionalMatch =
    capability === "metricsCatalog" || capability === "metricContext" || capability === "spansSearch";
  return session.tools
    .map((tool) => ({
      tool,
      score: scoreTool(tool, [...heuristic.requiredTerms], [...heuristic.optionalTerms], requireOptionalMatch),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))[0]?.tool.name;
}

function splitIdentifier(value: string): string[] {
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

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

function deriveSearchTerms(candidate: LambdaCandidate): string[] {
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

function buildIdentifierCandidates(candidate: LambdaCandidate): string[] {
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

async function discoverRepoMetricHints(candidate: LambdaCandidate, pctx: PipelineContext): Promise<string[]> {
  const output = await pctx.execSafeFn(
    'rg -o --no-filename --no-line-number "[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_-]+){2,}" -g "*.{ts,tsx,js,jsx,mjs,cjs,cs,py,go,java,rb,json,yml,yaml,md}" .',
    pctx.cwd,
  );
  if (!output) return [];

  const terms = deriveSearchTerms(candidate);
  return uniqueStrings(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^"|"$/g, ""))
      .filter((line) => METRIC_KEYWORDS.test(line))
      .filter((line) => terms.length === 0 || terms.some((term) => line.toLowerCase().includes(term))),
  ).slice(0, 20);
}

function extractMetricNames(parsed: unknown): string[] {
  if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === "string");
  if (isRecord(parsed) && Array.isArray(parsed.metrics)) {
    return parsed.metrics.filter((value): value is string => typeof value === "string");
  }
  if (typeof parsed !== "string") return [];
  return parsed
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s*/, "")
        .replace(/^"|"$/g, ""),
    )
    .filter((line) => /^[A-Za-z][A-Za-z0-9_.-]+$/.test(line));
}

async function searchMetricsCatalog(session: DatadogMcpSession, tool: string, term: string): Promise<string[]> {
  const attempts =
    tool.includes("search_datadog_metrics") || tool.includes("list_datadog_metrics")
      ? [{ name_filter: `*${term}*` }, { q: term }]
      : [{ q: term }, { name_filter: `*${term}*` }];

  for (const args of attempts) {
    const raw = await callDatadogMcpTool(session, tool, args);
    const parsed = parseDatadogMcpJson(raw);
    if (typeof parsed === "string" && /failed|error/i.test(parsed)) continue;
    const metrics = extractMetricNames(parsed);
    if (metrics.length > 0) return metrics;
  }

  return [];
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

    const tagMatch = line.match(/^\s+([A-Za-z0-9_.-]+):\s*$/);
    const tag = tagMatch?.[1];
    if (tag) {
      currentTag = tag;
      tags[tag] = tags[tag] ?? [];
      continue;
    }

    const valueMatch = line.match(/^\s+-\s*(.+?)\s*$/);
    const value = valueMatch?.[1];
    if (currentTag && value) {
      const values = tags[currentTag];
      if (values) values.push(value.replace(/^"|"$/g, ""));
    }
  }

  return tags;
}

function extractMetricContext(parsed: unknown): MetricContextSummary | undefined {
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

async function getMetricContext(
  session: DatadogMcpSession,
  tool: string | undefined,
  metric: string,
): Promise<MetricContextSummary | undefined> {
  if (!tool) return undefined;
  const raw = await callDatadogMcpTool(session, tool, {
    metric_name: metric,
    include_tag_values: true,
    max_tokens: 12000,
  });
  const parsed = parseDatadogMcpJson(raw);
  return extractMetricContext(parsed);
}

function normaliseValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findBestTagMatch(
  indexedTags: Record<string, string[]>,
  keys: string[],
  candidates: string[],
): TagFilter | undefined {
  const wanted = uniqueStrings(candidates)
    .map((candidate) => ({ raw: candidate, norm: normaliseValue(candidate) }))
    .filter((candidate) => candidate.norm.length > 0);

  let best: { filter: TagFilter; score: number } | undefined;
  for (const key of keys) {
    const values = indexedTags[key] ?? [];
    for (const value of values) {
      const valueNorm = normaliseValue(value);
      for (const candidate of wanted) {
        let score = -1;
        if (value.toLowerCase() === candidate.raw.toLowerCase()) score = 100;
        else if (valueNorm === candidate.norm) score = 95;
        else if (candidate.norm.length >= 4 && valueNorm.includes(candidate.norm)) score = 70;
        else if (candidate.norm.length >= 4 && candidate.norm.includes(valueNorm)) score = 60;
        if (!best || score > best.score) best = { filter: { key, value }, score };
      }
    }
  }

  return best?.score && best.score > 0 ? best.filter : undefined;
}

function scoreMetric(metric: string, searchTerms: string[], repoHints: Set<string>): number {
  const lower = metric.toLowerCase();
  let score = DURATION_KEYWORDS.test(metric) ? 50 : 10;
  if (!lower.startsWith("aws.lambda")) score += 20;
  if (repoHints.has(metric)) score += 30;
  if (searchTerms.some((term) => lower.includes(term))) score += 15;
  return score;
}

function pickCountMetric(durationMetric: string, metrics: string[]): string | undefined {
  if (durationMetric.endsWith(".duration")) {
    const countMetric = `${durationMetric.slice(0, -".duration".length)}.count`;
    if (metrics.includes(countMetric)) return countMetric;
  }

  const prefix = durationMetric.replace(/\.(duration|latency|runtime_duration)$/i, "");
  return metrics.find(
    (metric) => metric !== durationMetric && metric.startsWith(prefix) && /(?:count|requests)/i.test(metric),
  );
}

function chooseServiceHint(indexedTags: Record<string, string[]>): string | undefined {
  const services = indexedTags.service?.filter((value) => typeof value === "string" && value.trim().length > 0) ?? [];
  if (services.length === 1) return services[0];
  return undefined;
}

function buildFallbackPlans(metrics: string[], candidate: LambdaCandidate, env: string | undefined): MetricQueryPlan[] {
  const filtersByMetric: Array<{ metric: string; filters: TagFilter[]; provenance: string[]; score: number }> = [];
  const logicalName = candidate.constructId ? normaliseValue(candidate.constructId) : undefined;
  for (const metric of metrics.filter((entry) => DURATION_KEYWORDS.test(entry)).slice(0, 6)) {
    if (candidate.functionName) {
      filtersByMetric.push({
        metric,
        filters: [...(env ? [{ key: "env", value: env }] : []), { key: "functionname", value: candidate.functionName }],
        provenance: [`fallback functionname:${candidate.functionName}`, ...(env ? [`fallback env:${env}`] : [])],
        score: 20,
      });
    }

    if (logicalName) {
      filtersByMetric.push({
        metric,
        filters: [...(env ? [{ key: "env", value: env }] : []), { key: "lambda_function", value: logicalName }],
        provenance: [`fallback lambda_function:${logicalName}`, ...(env ? [`fallback env:${env}`] : [])],
        score: 15,
      });
    }

    if (!candidate.functionName && candidate.constructId) {
      filtersByMetric.push({
        metric,
        filters: [...(env ? [{ key: "env", value: env }] : []), { key: "functionname", value: candidate.constructId }],
        provenance: [`fallback functionname:${candidate.constructId}`, ...(env ? [`fallback env:${env}`] : [])],
        score: 10,
      });
    }
  }

  return filtersByMetric.map((entry) => ({
    durationMetric: entry.metric,
    countMetric: pickCountMetric(entry.metric, metrics),
    filters: entry.filters,
    provenance: entry.provenance,
    score: entry.score,
  }));
}

export async function discoverDatadogQueryPlans(
  session: DatadogMcpSession,
  candidate: LambdaCandidate,
  env: string | undefined,
  pctx: PipelineContext,
): Promise<MetricQueryPlan[]> {
  const searchTerms = deriveSearchTerms(candidate);
  const repoHints = await discoverRepoMetricHints(candidate, pctx);
  const repoHintSet = new Set(repoHints);
  const metricsCatalogTool = resolveDatadogTool(session, "metricsCatalog");
  const metricContextTool = resolveDatadogTool(session, "metricContext");

  const catalogMetrics: string[] = [];
  if (metricsCatalogTool) {
    for (const term of searchTerms.slice(0, 4)) {
      const found = await searchMetricsCatalog(session, metricsCatalogTool, term);
      catalogMetrics.push(...found);
    }
  }

  const metrics = uniqueStrings([...repoHints, ...catalogMetrics, ...DEFAULT_METRIC_CANDIDATES])
    .filter((metric) => METRIC_KEYWORDS.test(metric))
    .sort((a, b) => scoreMetric(b, searchTerms, repoHintSet) - scoreMetric(a, searchTerms, repoHintSet));

  const contexts = new Map<string, MetricContextSummary | undefined>();
  for (const metric of metrics.slice(0, 8)) {
    contexts.set(metric, await getMetricContext(session, metricContextTool, metric));
  }

  const identifiers = buildIdentifierCandidates(candidate);
  const plans: MetricQueryPlan[] = [];
  for (const metric of metrics.filter((entry) => DURATION_KEYWORDS.test(entry)).slice(0, 8)) {
    const context = contexts.get(metric);
    const indexedTags = context?.indexedTags ?? {};
    const lambdaFilter = findBestTagMatch(
      indexedTags,
      ["lambda_function", "functionname", "resource", "name", "function_arn"],
      identifiers,
    );
    const envFilter = env ? findBestTagMatch(indexedTags, ["env", "environment"], [env]) : undefined;
    const filters = [envFilter, lambdaFilter].filter((value): value is TagFilter => Boolean(value));
    const score =
      scoreMetric(metric, searchTerms, repoHintSet) +
      (lambdaFilter ? 100 : 0) +
      (envFilter ? 25 : 0) +
      (filters.some((filter) => filter.key === "lambda_function") ? 10 : 0);

    if (lambdaFilter || metric.startsWith("aws.lambda")) {
      const service = chooseServiceHint(indexedTags);
      plans.push({
        durationMetric: metric,
        countMetric: pickCountMetric(metric, metrics),
        filters,
        service,
        provenance: [
          `metric:${metric}`,
          ...filters.map((filter) => `matched ${filter.key}:${filter.value}`),
          ...(service ? [`matched service:${service}`] : []),
          ...(context ? ["used metric context discovery"] : []),
        ],
        score,
      });
    }
  }

  plans.push(...buildFallbackPlans(metrics, candidate, env));

  return plans
    .sort((a, b) => b.score - a.score || a.durationMetric.localeCompare(b.durationMetric))
    .filter(
      (plan, index, array) => array.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(plan)) === index,
    )
    .slice(0, 6);
}

export function formatFilters(filters: TagFilter[]): string {
  return filters.map((filter) => `${filter.key}:${filter.value}`).join(", ");
}

export function buildMetricFilter(filters: TagFilter[]): string {
  return filters.map((filter) => `${filter.key}:${filter.value}`).join(",");
}

export function buildLogQuery(filters: TagFilter[], fallbackName: string): string {
  if (filters.length === 0) return `"${fallbackName}" status:error`;
  return [...filters.map((filter) => `${filter.key}:${filter.value}`), "status:error"].join(" ");
}
