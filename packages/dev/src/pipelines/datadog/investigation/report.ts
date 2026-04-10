import { formatLambdaCandidate } from "../candidate.js";
import type { ReportInput } from "./contracts.js";
import { formatFilters } from "./plan-discovery.js";

export function formatReport({
  prompt,
  candidate,
  env,
  windowMs,
  summary,
  spanSummary,
  logs,
  attemptedPlans,
}: ReportInput): string {
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
