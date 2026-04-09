import {
  callDatadogMcpTool,
  type DatadogMcpSession,
  parseDatadogMcpJson,
  withDatadogMcpSession,
} from "@callumvass/forgeflow-shared/datadog";
import { type PipelineContext, pipelineResult, withRunLifecycle } from "@callumvass/forgeflow-shared/pipeline";
import { parseDatadogRequest } from "./request.js";
import { formatLambdaCandidate, type LambdaCandidate, resolveLambdaFromRepo } from "./resolver.js";

interface PercentileValue {
  label: string;
  value?: number;
}

interface PercentileResult {
  metric: string;
  values: PercentileValue[];
}

const DEFAULT_METRIC_CANDIDATES = [
  "aws.lambda.enhanced.duration",
  "aws.lambda.duration",
  "aws.lambda.enhanced.runtime_duration",
];

export async function runDatadog(prompt: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "datadog", (innerPctx) => runDatadogInner(prompt, innerPctx));
}

async function runDatadogInner(prompt: string, pctx: PipelineContext) {
  if (!prompt && pctx.ctx.hasUI) {
    const input = await pctx.ctx.ui.input("Datadog prompt?", "e.g. investigate why the billing lambda is slow in prod");
    prompt = input?.trim() ?? "";
  }

  if (!prompt) return pipelineResult("No Datadog prompt provided.", "datadog", []);

  const request = parseDatadogRequest(prompt);
  const resolution = await resolveLambdaFromRepo(pctx.cwd, prompt);
  if (typeof resolution === "string") return pipelineResult(resolution, "datadog", [], true);

  if (!resolution.selected) {
    const options = resolution.candidates
      .slice(0, 5)
      .map((candidate) => `- ${formatLambdaCandidate(candidate)}`)
      .join("\n");
    return pipelineResult(
      `I found multiple plausible Lambda candidates. Please re-run /datadog with one of these names:\n${options}`,
      "datadog",
      [],
    );
  }

  const selected = resolution.selected;
  if (!selected) {
    return pipelineResult("No Lambda candidate was selected for the Datadog investigation.", "datadog", [], true);
  }

  const result = await withDatadogMcpSession(async (session) => {
    const missing = ["query-metrics", "search-logs"].filter((tool) => !session.toolNames.includes(tool));
    if (missing.length > 0) {
      return `The current Datadog MCP server does not expose the tools forgeflow expects yet: ${missing.join(", ")}. Available tools: ${session.toolNames.join(", ")}`;
    }

    const percentiles = await fetchPercentiles(session, selected, request.env, request.windowMs);
    const logs =
      request.intent === "investigate"
        ? await fetchErrorLogs(session, selected, request.env, request.windowMs)
        : undefined;

    return formatReport(prompt, selected, request.env, request.windowMs, percentiles, logs);
  });

  if (typeof result === "string") return pipelineResult(result, "datadog", [], true);
  return pipelineResult(result, "datadog", []);
}

async function fetchPercentiles(
  session: DatadogMcpSession,
  candidate: LambdaCandidate,
  env: string | undefined,
  windowMs: number,
): Promise<PercentileResult | string> {
  const metricCandidates = await discoverMetricCandidates(session);
  const metrics = Array.from(new Set([...DEFAULT_METRIC_CANDIDATES, ...metricCandidates]));
  const rollupSeconds = Math.max(60, Math.round(windowMs / 1000));
  const to = Date.now();
  const from = to - windowMs;
  const tags = [`functionname:${candidate.functionName ?? candidate.constructId ?? ""}`];
  if (env) tags.push(`env:${env}`);
  const filter = tags.filter(Boolean).join(",");

  for (const metric of metrics) {
    const values: PercentileValue[] = [];
    for (const label of ["p50", "p95", "p99", "avg"]) {
      const query = `${label}:${metric}{${filter}}.rollup(avg, ${rollupSeconds})`;
      const raw = await callDatadogMcpTool(session, "query-metrics", { query, from, to });
      const parsed = parseDatadogMcpJson(raw);
      if (typeof parsed === "string") {
        values.push({ label });
        continue;
      }

      const value = extractLatestMetricValue(parsed);
      values.push({ label, value });
    }

    if (values.some((entry) => typeof entry.value === "number")) {
      return { metric, values };
    }
  }

  return `No Datadog duration metric data was found for ${candidate.functionName ?? candidate.constructId ?? candidate.file}.`;
}

async function discoverMetricCandidates(session: DatadogMcpSession): Promise<string[]> {
  if (!session.toolNames.includes("get-metrics")) return [];
  const raw = await callDatadogMcpTool(session, "get-metrics", { q: "lambda" });
  const parsed = parseDatadogMcpJson(raw);
  if (!parsed || typeof parsed === "string" || typeof parsed !== "object" || !("metrics" in parsed)) return [];
  const metrics = Array.isArray((parsed as { metrics?: unknown }).metrics)
    ? (parsed as { metrics: unknown[] }).metrics
    : [];
  return metrics
    .filter((metric): metric is string => typeof metric === "string")
    .filter((metric) => /lambda/i.test(metric) && /duration/i.test(metric))
    .slice(0, 10);
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
  candidate: LambdaCandidate,
  env: string | undefined,
  windowMs: number,
): Promise<{ count: number; topMessages: string[] } | string> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - windowMs).toISOString();
  const lambdaName = candidate.functionName ?? candidate.constructId ?? candidate.file;
  const queryParts = [`"${lambdaName}"`, "status:error"];
  if (env) queryParts.push(`env:${env}`);

  const raw = await callDatadogMcpTool(session, "search-logs", {
    query: queryParts.join(" "),
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

function normaliseLogMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function formatReport(
  prompt: string,
  candidate: LambdaCandidate,
  env: string | undefined,
  windowMs: number,
  percentiles: PercentileResult | string,
  logs: { count: number; topMessages: string[] } | string | undefined,
): string {
  const lines = [
    `Prompt: ${prompt}`,
    `Resolved Lambda: ${formatLambdaCandidate(candidate)}`,
    `Window: ${formatWindow(windowMs)}${env ? ` (env ${env})` : ""}`,
    "",
  ];

  if (typeof percentiles === "string") {
    lines.push(percentiles);
  } else {
    lines.push(`Metric used: ${percentiles.metric}`);
    for (const entry of percentiles.values) {
      lines.push(`- ${entry.label}: ${formatDuration(entry.value)}`);
    }
  }

  if (logs) {
    lines.push("", "Recent error logs:");
    if (typeof logs === "string") {
      lines.push(logs);
    } else if (logs.count === 0) {
      lines.push("- No recent error logs matched the resolved Lambda name.");
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
