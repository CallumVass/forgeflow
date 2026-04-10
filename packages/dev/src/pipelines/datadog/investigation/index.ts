import { resolveDatadogMcpTool, withDatadogMcpSession } from "@callumvass/forgeflow-shared/datadog";
import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import type { LambdaCandidate } from "../candidate.js";
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

export async function runDatadogInvestigation({ prompt, request, candidate, pctx }: RunDatadogInvestigationInput) {
  const result = await withDatadogMcpSession(async (session) => {
    const metricsQueryTool = resolveDatadogMcpTool(session, "metricsQuery");
    const logsSearchTool = resolveDatadogMcpTool(session, "logsSearch");
    const spansSearchTool = resolveDatadogMcpTool(session, "spansSearch");
    if (!metricsQueryTool) {
      return `The current Datadog MCP server does not expose a metric-query tool forgeflow can use. Available tools: ${session.toolNames.join(", ")}`;
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
    const logs =
      request.intent === "investigate" && logsSearchTool
        ? await fetchErrorLogs(
            session,
            logsSearchTool,
            buildLogQuery(
              summary?.plan.filters ?? (request.env ? [{ key: "env", value: request.env }] : []),
              candidate.functionName ?? candidate.constructId ?? candidate.file,
            ),
            request.windowMs,
          )
        : request.intent === "investigate"
          ? "No Datadog log-search tool is available on the current MCP server."
          : undefined;

    return formatReport({
      prompt,
      candidate,
      env: request.env,
      windowMs: request.windowMs,
      summary,
      spanSummary,
      logs,
      attemptedPlans: plans,
    });
  });

  return typeof result === "string" ? result : result;
}

function buildSpanQueries(
  candidate: LambdaCandidate,
  env: string | undefined,
  plans: Array<{ filters: { key: string; value: string }[]; service?: string }>,
): string[] {
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
