import { resolveDatadogMcpTool, withDatadogMcpSession } from "@callumvass/forgeflow-shared/datadog";
import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import type { LambdaCandidate } from "../candidate.js";
import { buildWildcardPattern } from "./candidate-identifiers.js";
import type { MetricQueryPlan } from "./contracts.js";
import { buildLogQuery, discoverDatadogQueryPlans } from "./plan-discovery.js";
import { fetchErrorLogs, fetchSpanSummary, fetchSummary } from "./query-execution.js";
import { formatReport } from "./report.js";

interface DatadogRequestLike {
  env?: string;
  intent: "percentiles" | "investigate";
  windowMs: number;
}

interface RunDatadogInvestigationInput {
  prompt: string;
  request: DatadogRequestLike;
  candidate: LambdaCandidate;
  pctx: PipelineContext;
}

interface DatadogInvestigationResult {
  report: string;
  isError?: true;
}

export async function runDatadogInvestigation({
  prompt,
  request,
  candidate,
  pctx,
}: RunDatadogInvestigationInput): Promise<DatadogInvestigationResult> {
  const result = await withDatadogMcpSession(async (session) => {
    const metricsQueryTool = resolveDatadogMcpTool(session, "metricsQuery");
    const logsSearchTool = resolveDatadogMcpTool(session, "logsSearch");
    const spansSearchTool = resolveDatadogMcpTool(session, "spansSearch");
    if (!metricsQueryTool) {
      return {
        report: `The current Datadog MCP server does not expose a metric-query tool forgeflow can use. Available tools: ${session.toolNames.join(", ")}`,
        isError: true as const,
      };
    }

    const plans = await discoverDatadogQueryPlans(session, candidate, request.env, pctx);
    const summary = await fetchSummary(session, metricsQueryTool, plans, request.windowMs);
    const spanSummary =
      !summary && spansSearchTool
        ? await fetchSpanSummary(
            session,
            spansSearchTool,
            buildSpanQueries(candidate, request.env, plans),
            request.windowMs,
          )
        : undefined;
    const logFilters =
      summary?.plan.filters ?? plans[0]?.filters ?? (request.env ? [{ key: "env", value: request.env }] : []);
    const logs =
      request.intent === "investigate" && logsSearchTool
        ? await fetchErrorLogs(
            session,
            logsSearchTool,
            buildLogQuery(logFilters, candidate.functionName ?? candidate.constructId ?? candidate.file),
            request.windowMs,
          )
        : request.intent === "investigate"
          ? "No Datadog log-search tool is available on the current MCP server."
          : undefined;

    return {
      report: formatReport({
        prompt,
        candidate,
        env: request.env,
        windowMs: request.windowMs,
        summary,
        spanSummary,
        logs,
        attemptedPlans: plans,
      }),
    };
  });

  if (typeof result === "string") return { report: result, isError: true as const };
  return result;
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
  return buildWildcardPattern(source, 4);
}
