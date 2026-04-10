import {
  callDatadogMcpTool,
  type DatadogMcpSession,
  parseDatadogMcpJson,
  resolveDatadogMcpTool,
} from "@callumvass/forgeflow-shared/datadog";
import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import type { LambdaCandidate } from "../candidate.js";
import {
  buildIdentifierCandidates,
  buildWildcardIdentifierPatterns,
  deriveSearchTerms,
  uniqueStrings,
} from "./candidate-identifiers.js";
import type { MetricQueryPlan, TagFilter } from "./contracts.js";
import { chooseServiceHint, extractMetricContext, findBestTagMatch } from "./metric-context.js";

const DEFAULT_METRIC_CANDIDATES = [
  "aws.lambda.enhanced.duration",
  "aws.lambda.duration",
  "aws.lambda.enhanced.runtime_duration",
];

const METRIC_KEYWORDS = /(?:duration|count|error|errors|latency|outcome)/i;
const DURATION_KEYWORDS = /(?:duration|latency|runtime_duration)/i;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function getMetricContext(session: DatadogMcpSession, tool: string | undefined, metric: string) {
  if (!tool) return undefined;
  const raw = await callDatadogMcpTool(session, tool, {
    metric_name: metric,
    include_tag_values: true,
    max_tokens: 12000,
  });
  return extractMetricContext(parseDatadogMcpJson(raw));
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

function buildFallbackPlans(metrics: string[], candidate: LambdaCandidate, env: string | undefined): MetricQueryPlan[] {
  const plans: Array<{ metric: string; filters: TagFilter[]; provenance: string[]; score: number }> = [];
  const logicalName = candidate.constructId
    ? candidate.constructId.toLowerCase().replace(/[^a-z0-9]+/g, "")
    : undefined;
  const wildcardPatterns = buildWildcardIdentifierPatterns(candidate);

  for (const metric of metrics.filter((entry) => DURATION_KEYWORDS.test(entry)).slice(0, 6)) {
    if (candidate.functionName) {
      plans.push({
        metric,
        filters: [...(env ? [{ key: "env", value: env }] : []), { key: "functionname", value: candidate.functionName }],
        provenance: [`fallback functionname:${candidate.functionName}`, ...(env ? [`fallback env:${env}`] : [])],
        score: 20,
      });
    }

    if (logicalName) {
      plans.push({
        metric,
        filters: [...(env ? [{ key: "env", value: env }] : []), { key: "lambda_function", value: logicalName }],
        provenance: [`fallback lambda_function:${logicalName}`, ...(env ? [`fallback env:${env}`] : [])],
        score: 15,
      });
    }

    if (!candidate.functionName && candidate.constructId) {
      plans.push({
        metric,
        filters: [...(env ? [{ key: "env", value: env }] : []), { key: "functionname", value: candidate.constructId }],
        provenance: [`fallback functionname:${candidate.constructId}`, ...(env ? [`fallback env:${env}`] : [])],
        score: 10,
      });
    }

    for (const pattern of wildcardPatterns) {
      for (const [key, score] of [
        ["functionname", 12],
        ["name", 11],
        ["function_arn", 5],
        ["resource", 5],
      ] as const) {
        plans.push({
          metric,
          filters: [...(env ? [{ key: "env", value: env }] : []), { key, value: pattern }],
          provenance: [`fallback wildcard ${key}:${pattern}`, ...(env ? [`fallback env:${env}`] : [])],
          score,
        });
      }
    }
  }

  return plans.map((entry) => ({
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
  const metricsCatalogTool = resolveDatadogMcpTool(session, "metricsCatalog");
  const metricContextTool = resolveDatadogMcpTool(session, "metricContext");

  const catalogMetrics: string[] = [];
  if (metricsCatalogTool) {
    for (const term of searchTerms.slice(0, 4)) {
      catalogMetrics.push(...(await searchMetricsCatalog(session, metricsCatalogTool, term)));
    }
  }

  const metrics = uniqueStrings([...repoHints, ...catalogMetrics, ...DEFAULT_METRIC_CANDIDATES])
    .filter((metric) => METRIC_KEYWORDS.test(metric))
    .sort((a, b) => scoreMetric(b, searchTerms, repoHintSet) - scoreMetric(a, searchTerms, repoHintSet));

  const contexts = new Map<string, Awaited<ReturnType<typeof getMetricContext>>>();
  for (const metric of metrics.slice(0, 8))
    contexts.set(metric, await getMetricContext(session, metricContextTool, metric));

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
      (lambdaFilter || filters.length > 0 ? scoreMetric(metric, searchTerms, repoHintSet) : 1) +
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
