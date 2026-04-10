import { callDatadogMcpTool, type DatadogMcpSession, parseDatadogMcpJson } from "@callumvass/forgeflow-shared/datadog";
import type { InvestigationSummary, LogSummary, MetricQueryPlan, SpanSummary } from "./contracts.js";
import { buildMetricFilter } from "./plan-discovery.js";

const DURATION_LABELS = ["avg", "p95", "p99", "max"] as const;

export async function fetchSummary(
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

  const percentiles = {
    metric: plan.durationMetric,
    values: DURATION_LABELS.map((label) => ({
      label,
      value: queryResults.get(`${label}:${plan.durationMetric}{${filter}}`),
    })),
  };
  const requestCount = queryResults.get(totalExpression);
  const failureCount = failureExpression ? queryResults.get(failureExpression) : undefined;

  if (!percentiles.values.some((entry) => typeof entry.value === "number") && typeof requestCount !== "number") {
    return undefined;
  }
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
  const batchRaw = await callDatadogMcpTool(session, metricsQueryTool, {
    queries: expressions,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    max_tokens: 12000,
  });
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

export async function fetchErrorLogs(
  session: DatadogMcpSession,
  logsSearchTool: string,
  query: string,
  windowMs: number,
): Promise<LogSummary | string> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - windowMs).toISOString();
  const raw = await callDatadogMcpTool(session, logsSearchTool, {
    query,
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
  for (const message of messages) counts.set(message, (counts.get(message) ?? 0) + 1);

  const topMessages = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([message, count]) => `${count}× ${message}`);

  return { count: logs.length, topMessages };
}

export async function fetchSpanSummary(
  session: DatadogMcpSession,
  spansSearchTool: string,
  queries: string[],
  windowMs: number,
): Promise<SpanSummary | undefined> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - windowMs).toISOString();

  for (const query of queries) {
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

function appendFilter(filter: string, extra: string): string {
  return filter ? `${filter},${extra}` : extra;
}

function extractSpanDurationsMs(parsed: unknown): number[] {
  return extractSpanEntries(parsed)
    .map(extractSpanDurationMs)
    .filter((value): value is number => typeof value === "number");
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
  if (typeof duration === "number" && Number.isFinite(duration))
    return duration > 1_000_000 ? duration / 1_000_000 : duration;
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
