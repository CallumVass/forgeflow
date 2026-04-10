import {
  callDatadogMcpTool,
  type DatadogMcpSession,
  parseDatadogMcpJson,
  withDatadogMcpSession,
} from "@callumvass/forgeflow-shared/datadog";
import {
  type PipelineContext,
  pipelineResult,
  type StageResult,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { formatLambdaCandidate, type LambdaCandidate } from "./candidate.js";
import {
  buildLogQuery,
  buildMetricFilter,
  discoverDatadogQueryPlans,
  formatFilters,
  type MetricQueryPlan,
  resolveDatadogTool,
} from "./discovery.js";
import { exploreLambdaWithAgent } from "./explorer.js";
import { parseDatadogRequest } from "./request.js";

interface PercentileValue {
  label: string;
  value?: number;
}

interface PercentileResult {
  metric: string;
  values: PercentileValue[];
}

interface InvestigationSummary {
  plan: MetricQueryPlan;
  percentiles: PercentileResult;
  requestCount?: number;
  failureCount?: number;
}

interface SpanSummary {
  query: string;
  count: number;
  avgDurationMs?: number;
  p95DurationMs?: number;
  maxDurationMs?: number;
}

const DURATION_LABELS = ["avg", "p95", "p99", "max"] as const;

export async function runDatadog(prompt: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "datadog", (innerPctx) => runDatadogInner(prompt, innerPctx));
}

async function runDatadogInner(prompt: string, pctx: PipelineContext) {
  const stages: StageResult[] = [];

  if (!prompt && pctx.ctx.hasUI) {
    const input = await pctx.ctx.ui.input("Datadog prompt?", "e.g. investigate why the billing lambda is slow in prod");
    prompt = input?.trim() ?? "";
  }

  if (!prompt) return pipelineResult("No Datadog prompt provided.", "datadog", stages);

  const request = parseDatadogRequest(prompt);
  const agentResolution = await exploreLambdaWithAgent(prompt, pctx, stages);
  if (typeof agentResolution === "string") return pipelineResult(agentResolution, "datadog", stages, true);

  const selected = agentResolution.selected;
  if (!selected && agentResolution.ambiguous && agentResolution.candidates.length > 0) {
    const options = agentResolution.candidates
      .slice(0, 5)
      .map((candidate) => `- ${formatLambdaCandidate(candidate)}`)
      .join("\n");
    return pipelineResult(
      `I found multiple plausible Lambda candidates. Please re-run /datadog with one of these names:\n${options}`,
      "datadog",
      stages,
    );
  }

  if (!selected) {
    return pipelineResult("No Lambda candidate was selected for the Datadog investigation.", "datadog", stages, true);
  }

  const result = await withDatadogMcpSession(async (session) => {
    const metricsQueryTool = resolveDatadogTool(session, "metricsQuery");
    const logsSearchTool = resolveDatadogTool(session, "logsSearch");
    const spansSearchTool = resolveDatadogTool(session, "spansSearch");
    if (!metricsQueryTool) {
      return `The current Datadog MCP server does not expose a metric-query tool forgeflow can use. Available tools: ${session.toolNames.join(", ")}`;
    }

    const plans = await discoverDatadogQueryPlans(session, selected, request.env, pctx);
    const summary = await fetchSummary(session, metricsQueryTool, plans, request.windowMs);
    const spanSummary =
      !summary && spansSearchTool
        ? await fetchSpanSummary(session, spansSearchTool, selected, request.env, request.windowMs, plans)
        : undefined;
    const logs =
      request.intent === "investigate" && logsSearchTool
        ? await fetchErrorLogs(
            session,
            logsSearchTool,
            selected,
            request.env,
            request.windowMs,
            summary?.plan ?? plans[0],
          )
        : request.intent === "investigate"
          ? "No Datadog log-search tool is available on the current MCP server."
          : undefined;

    return formatReport(prompt, selected, request.env, request.windowMs, summary, spanSummary, logs, plans);
  });

  if (typeof result === "string") return pipelineResult(result, "datadog", stages, true);
  return pipelineResult(result, "datadog", stages);
}

async function fetchSummary(
  session: DatadogMcpSession,
  metricsQueryTool: string,
  plans: MetricQueryPlan[],
  windowMs: number,
): Promise<InvestigationSummary | undefined> {
  for (const plan of plans) {
    const summary = await queryPlanSummary(session, metricsQueryTool, plan, windowMs);
    if (!summary) continue;
    if (
      summary.percentiles.values.some((entry) => typeof entry.value === "number") ||
      typeof summary.requestCount === "number"
    ) {
      return summary;
    }
  }
  return undefined;
}

async function queryPlanSummary(
  session: DatadogMcpSession,
  metricsQueryTool: string,
  plan: MetricQueryPlan,
  windowMs: number,
): Promise<InvestigationSummary | undefined> {
  const filter = buildMetricFilter(plan.filters);
  const expressions = DURATION_LABELS.map((label) => `${label}:${plan.durationMetric}{${filter}}`);
  const totalExpression = plan.countMetric
    ? `sum:${plan.countMetric}{${filter}}.as_count()`
    : `count:${plan.durationMetric}{${filter}}.as_count()`;
  const failureExpression = plan.countMetric
    ? `sum:${plan.countMetric}{${appendFilter(filter, "result:failure")}}.as_count()`
    : undefined;

  const queryResults = await runMetricQueries(
    session,
    metricsQueryTool,
    [...expressions, totalExpression, ...(failureExpression ? [failureExpression] : [])],
    windowMs,
  );

  const percentiles: PercentileResult = {
    metric: plan.durationMetric,
    values: DURATION_LABELS.map((label) => ({
      label,
      value: queryResults.get(`${label}:${plan.durationMetric}{${filter}}`),
    })),
  };
  const requestCount = queryResults.get(totalExpression);
  const failureCount = failureExpression ? queryResults.get(failureExpression) : undefined;

  if (!percentiles.values.some((entry) => typeof entry.value === "number") && typeof requestCount !== "number")
    return undefined;
  return { plan, percentiles, requestCount, failureCount };
}

async function runMetricQueries(
  session: DatadogMcpSession,
  metricsQueryTool: string,
  expressions: string[],
  windowMs: number,
): Promise<Map<string, number | undefined>> {
  const to = Date.now();
  const from = to - windowMs;
  const batchArgs = {
    queries: expressions,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    max_tokens: 12000,
  };
  const batchRaw = await callDatadogMcpTool(session, metricsQueryTool, batchArgs);
  const batchParsed = parseDatadogMcpJson(batchRaw);
  const batchResult = extractMetricResults(batchParsed, expressions);
  if (batchResult.size > 0) return batchResult;

  const legacyResult = new Map<string, number | undefined>();
  for (const expression of expressions) {
    const raw = await callDatadogMcpTool(session, metricsQueryTool, { query: expression, from, to });
    const parsed = parseDatadogMcpJson(raw);
    legacyResult.set(expression, extractLatestMetricValue(parsed));
  }
  return legacyResult;
}

function extractMetricResults(parsed: unknown, expressions: string[]): Map<string, number | undefined> {
  const results = new Map<string, number | undefined>();
  if (!Array.isArray(parsed)) return results;

  for (const expression of expressions) {
    const entry = parsed.find(
      (value) => value && typeof value === "object" && (value as { expression?: unknown }).expression === expression,
    ) as { expression?: string; overall_stats?: { avg?: unknown; sum?: unknown; max?: unknown } } | undefined;

    if (!entry?.overall_stats) continue;
    if (expression.includes(".as_count()")) {
      const sum = entry.overall_stats.sum;
      results.set(expression, typeof sum === "number" && Number.isFinite(sum) ? sum : undefined);
      continue;
    }

    if (expression.startsWith("max:")) {
      const max = entry.overall_stats.max;
      const avg = entry.overall_stats.avg;
      results.set(
        expression,
        typeof max === "number" && Number.isFinite(max)
          ? max
          : typeof avg === "number" && Number.isFinite(avg)
            ? avg
            : undefined,
      );
      continue;
    }

    const avg = entry.overall_stats.avg;
    results.set(expression, typeof avg === "number" && Number.isFinite(avg) ? avg : undefined);
  }

  return results;
}

function extractLatestMetricValue(parsed: unknown): number | undefined {
  if (!parsed || typeof parsed !== "object" || !("series" in parsed)) return undefined;
  const series = Array.isArray((parsed as { series?: unknown }).series) ? (parsed as { series: unknown[] }).series : [];
  for (const entry of series) {
    if (!entry || typeof entry !== "object" || !("points" in entry)) continue;
    const points = Array.isArray((entry as { points?: unknown }).points) ? (entry as { points: unknown[] }).points : [];
    for (let index = points.length - 1; index >= 0; index--) {
      const point = points[index];
      if (!point || typeof point !== "object" || !("value" in point)) continue;
      const value = (point as { value?: unknown }).value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

async function fetchErrorLogs(
  session: DatadogMcpSession,
  logsSearchTool: string,
  candidate: LambdaCandidate,
  env: string | undefined,
  windowMs: number,
  plan: MetricQueryPlan | undefined,
): Promise<{ count: number; topMessages: string[] } | string> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - windowMs).toISOString();
  const fallbackName = candidate.functionName ?? candidate.constructId ?? candidate.file;
  const raw = await callDatadogMcpTool(session, logsSearchTool, {
    query: buildLogQuery(plan?.filters ?? (env ? [{ key: "env", value: env }] : []), fallbackName),
    from,
    to,
    limit: 20,
    sort: "-timestamp",
  });
  const parsed = parseDatadogMcpJson(raw);
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return { count: 0, topMessages: [] };

  const logs = Array.isArray((parsed as { logs?: unknown }).logs) ? (parsed as { logs: unknown[] }).logs : [];
  const messages = logs
    .map((entry) => (entry && typeof entry === "object" ? (entry as { message?: unknown }).message : undefined))
    .filter((message): message is string => typeof message === "string" && message.trim().length > 0)
    .map((message) => normaliseLogMessage(message));

  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }

  const topMessages = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([message, count]) => `${count}× ${message}`);

  return { count: logs.length, topMessages };
}

function appendFilter(filter: string, extra: string): string {
  return filter ? `${filter},${extra}` : extra;
}

async function fetchSpanSummary(
  session: DatadogMcpSession,
  spansSearchTool: string,
  candidate: LambdaCandidate,
  env: string | undefined,
  windowMs: number,
  plans: MetricQueryPlan[],
): Promise<SpanSummary | undefined> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - windowMs).toISOString();

  for (const query of buildSpanQueries(candidate, env, plans)) {
    const raw = await callDatadogMcpTool(session, spansSearchTool, {
      query,
      from,
      to,
      limit: 50,
      sort: "-timestamp",
    });
    const parsed = parseDatadogMcpJson(raw);
    const durations = extractSpanDurationsMs(parsed);
    if (durations.length === 0) continue;

    return {
      query,
      count: durations.length,
      avgDurationMs: average(durations),
      p95DurationMs: percentile(durations, 0.95),
      maxDurationMs: Math.max(...durations),
    };
  }

  return undefined;
}

function buildSpanQueries(candidate: LambdaCandidate, env: string | undefined, plans: MetricQueryPlan[]): string[] {
  const queries = new Set<string>();
  const resourceWildcard = buildResourceWildcard(candidate);

  for (const plan of plans.slice(0, 3)) {
    const parts = [
      ...plan.filters.map((filter) => `${filter.key}:${filter.value}`),
      ...(plan.service ? [`service:${plan.service}`] : []),
    ];
    if (resourceWildcard) parts.push(`resource_name:${resourceWildcard}`);
    if (parts.length > 0) queries.add(parts.join(" "));
  }

  if (env && resourceWildcard) queries.add(`env:${env} resource_name:${resourceWildcard}`);
  if (env) {
    const fallbackName = candidate.functionName ?? candidate.constructId ?? candidate.className;
    if (fallbackName) queries.add(`env:${env} ${fallbackName}`);
  }
  if (resourceWildcard) queries.add(`resource_name:${resourceWildcard}`);

  return Array.from(queries);
}

function buildResourceWildcard(candidate: LambdaCandidate): string | undefined {
  const source = candidate.constructId ?? candidate.className ?? candidate.functionName ?? candidate.variableName;
  if (!source) return undefined;
  const tokens = source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2 && !["lambda", "function"].includes(part))
    .slice(0, 4);
  if (tokens.length === 0) return undefined;
  return `*${tokens.join("*")}*`;
}

function extractSpanDurationsMs(parsed: unknown): number[] {
  const entries = extractSpanEntries(parsed);
  return entries.map(extractSpanDurationMs).filter((value): value is number => typeof value === "number");
}

function extractSpanEntries(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (!isRecord(parsed)) return [];

  for (const key of ["spans", "data", "results", "items"]) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [];
}

function extractSpanDurationMs(entry: Record<string, unknown>): number | undefined {
  const directMs = [entry.duration_ms, entry.durationMs].find(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (typeof directMs === "number") return directMs;

  const directNs = [entry.duration_ns, entry.durationNs].find(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (typeof directNs === "number") return directNs / 1_000_000;

  const duration = entry.duration;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return duration > 1_000_000 ? duration / 1_000_000 : duration;
  }

  return undefined;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseLogMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function formatReport(
  prompt: string,
  candidate: LambdaCandidate,
  env: string | undefined,
  windowMs: number,
  summary: InvestigationSummary | undefined,
  spanSummary: SpanSummary | undefined,
  logs: { count: number; topMessages: string[] } | string | undefined,
  attemptedPlans: MetricQueryPlan[],
): string {
  const lines = [
    `Prompt: ${prompt}`,
    `Resolved Lambda: ${formatLambdaCandidate(candidate)}`,
    `Window: ${formatWindow(windowMs)}${env ? ` (env ${env})` : ""}`,
    "",
  ];

  if (!summary && spanSummary) {
    lines.push("Metric data was sparse, so Datadog trace search was used as a fallback.");
    lines.push(`Trace query used: ${spanSummary.query}`);
    lines.push(`Span count: ${spanSummary.count}`);
    lines.push(`- avg: ${formatDuration(spanSummary.avgDurationMs)}`);
    lines.push(`- p95: ${formatDuration(spanSummary.p95DurationMs)}`);
    lines.push(`- max: ${formatDuration(spanSummary.maxDurationMs)}`);
  } else if (!summary) {
    lines.push(
      `No Datadog metric data was found for ${candidate.functionName ?? candidate.constructId ?? candidate.file}.`,
    );
    if (attemptedPlans.length > 0) {
      lines.push("Attempted query plans:");
      for (const plan of attemptedPlans.slice(0, 4)) {
        lines.push(`- ${plan.durationMetric}${plan.filters.length > 0 ? ` with ${formatFilters(plan.filters)}` : ""}`);
      }
    }
  } else {
    lines.push(`Metric used: ${summary.percentiles.metric}`);
    lines.push(`Filters used: ${summary.plan.filters.length > 0 ? formatFilters(summary.plan.filters) : "none"}`);
    for (const entry of summary.percentiles.values) lines.push(`- ${entry.label}: ${formatDuration(entry.value)}`);
    if (typeof summary.requestCount === "number") lines.push(`Request count: ${Math.round(summary.requestCount)}`);
    if (typeof summary.failureCount === "number") {
      const percentage =
        typeof summary.requestCount === "number" && summary.requestCount > 0
          ? ` (${((summary.failureCount / summary.requestCount) * 100).toFixed(1)}%)`
          : "";
      lines.push(`Failure count: ${Math.round(summary.failureCount)}${percentage}`);
    }
    if (summary.plan.provenance.length > 0) lines.push(`Provenance: ${summary.plan.provenance.join("; ")}`);
  }

  if (logs) {
    lines.push("", "Recent error logs:");
    if (typeof logs === "string") {
      lines.push(logs);
    } else if (logs.count === 0) {
      lines.push("- No recent error logs matched the resolved Lambda name/tags.");
    } else {
      lines.push(`- ${logs.count} recent error logs matched.`);
      for (const message of logs.topMessages) lines.push(`- ${message}`);
    }
  }

  return lines.join("\n");
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "no data";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function formatWindow(windowMs: number): string {
  const hours = windowMs / (60 * 60 * 1000);
  if (hours >= 24 && Number.isInteger(hours / 24)) return `last ${hours / 24}d`;
  if (hours >= 1) return `last ${hours}h`;
  return `last ${Math.round(windowMs / 60000)}m`;
}
