import {
  callMcpTool,
  type McpSession,
  type McpTool,
  parseMcpJson,
  resolveMcpTool,
  withMcpSession,
} from "../mcp/index.js";
import { getDatadogMcpConfig, getDatadogMcpOauthStatePath } from "./oauth.js";

export interface DatadogMcpTool extends McpTool {}

export interface DatadogMcpSession extends McpSession {}

type DatadogToolCapability = "metricsQuery" | "logsSearch" | "metricsCatalog";

export async function withDatadogMcpSession<T>(fn: (session: DatadogMcpSession) => Promise<T>): Promise<T | string> {
  const config = getDatadogMcpConfig();
  if (typeof config === "string") return config;

  return withMcpSession(
    config,
    getDatadogMcpOauthStatePath(),
    {
      serviceLabel: "Datadog MCP",
      loginCommand: "datadog-login",
      sessionClientName: "forgeflow-datadog-mcp",
    },
    fn,
  );
}

export async function callDatadogMcpTool(session: DatadogMcpSession, name: string, args: Record<string, unknown>) {
  return callMcpTool(session, name, args, "Datadog MCP");
}

export function parseDatadogMcpJson(result: unknown): unknown | string {
  return parseMcpJson(result, "Datadog MCP");
}

export function resolveDatadogMcpTool(
  session: Pick<DatadogMcpSession, "tools" | "toolNames">,
  capability: DatadogToolCapability,
): string | undefined {
  const exactAliases: Record<DatadogToolCapability, string[]> = {
    metricsQuery: ["query-metrics", "get_datadog_metric", "query_datadog_metrics"],
    logsSearch: ["search-logs", "search_datadog_logs"],
    metricsCatalog: ["get-metrics", "list_datadog_metrics", "search_datadog_metrics"],
  };

  const heuristics: Record<DatadogToolCapability, { requiredTerms: string[]; optionalTerms: string[] }> = {
    metricsQuery: { requiredTerms: ["metric"], optionalTerms: ["query", "timeseries", "measure", "point", "value"] },
    logsSearch: { requiredTerms: ["log"], optionalTerms: ["search", "query", "events"] },
    metricsCatalog: { requiredTerms: ["metric"], optionalTerms: ["list", "catalog", "search", "discover"] },
  };

  return resolveMcpTool(
    session,
    exactAliases[capability],
    heuristics[capability].requiredTerms,
    heuristics[capability].optionalTerms,
  );
}

export async function getDatadogMcpToolNames(): Promise<string[] | string> {
  return withDatadogMcpSession(async (session) => session.toolNames);
}
