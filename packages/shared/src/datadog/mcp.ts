import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDatadogMcpConfig, readDatadogMcpOauthState, writeDatadogMcpOauthState } from "./oauth.js";

export interface DatadogMcpTool {
  name: string;
  description?: string;
}

export interface DatadogMcpSession {
  client: Client;
  transport: StreamableHTTPClientTransport;
  serverUrl: string;
  tools: DatadogMcpTool[];
  toolNames: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatErrorMessage(prefix: string, err: unknown): string {
  return `${prefix}: ${(err as Error).message}`;
}

async function connectDatadogMcpSession(): Promise<DatadogMcpSession | string> {
  const config = getDatadogMcpConfig();
  if (typeof config === "string") return config;

  const state = await readDatadogMcpOauthState();
  if (!state?.tokens?.access_token) {
    return "Datadog MCP is configured but no login was found. Run /datadog-login.";
  }

  const provider = {
    get redirectUrl() {
      return config.redirectUri;
    },
    get clientMetadata() {
      return {
        client_name: config.clientName,
        redirect_uris: [config.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: config.clientSecret ? "client_secret_post" : "none",
        ...(config.scope ? { scope: config.scope } : {}),
      };
    },
    clientMetadataUrl: config.clientMetadataUrl,
    clientInformation: () => state.clientInformation,
    saveClientInformation: async (clientInformation: unknown) => {
      if (clientInformation && typeof clientInformation === "object") {
        state.clientInformation = clientInformation as never;
        await writeDatadogMcpOauthState(state);
      }
    },
    tokens: () => state.tokens,
    saveTokens: async (tokens: unknown) => {
      if (tokens && typeof tokens === "object") {
        state.tokens = tokens as never;
        await writeDatadogMcpOauthState(state);
      }
    },
    redirectToAuthorization: () => undefined,
    saveCodeVerifier: async (codeVerifier: string) => {
      state.codeVerifier = codeVerifier;
      await writeDatadogMcpOauthState(state);
    },
    codeVerifier: () => state.codeVerifier ?? "",
    discoveryState: () => state.discoveryState,
    saveDiscoveryState: async (discoveryState: unknown) => {
      if (discoveryState && typeof discoveryState === "object") {
        state.discoveryState = discoveryState as never;
        await writeDatadogMcpOauthState(state);
      }
    },
  };

  const client = new Client({ name: "forgeflow-datadog-mcp", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl), { authProvider: provider });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const availableTools = tools.tools
      .map((tool: { name: string; description?: string }) => ({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      client,
      transport,
      serverUrl: config.serverUrl,
      tools: availableTools,
      toolNames: availableTools.map((tool) => tool.name),
    };
  } catch (err) {
    await transport.close().catch(() => undefined);
    if (err instanceof UnauthorizedError) {
      return "Datadog MCP authorisation has expired or is missing. Run /datadog-login.";
    }
    return formatErrorMessage("Failed to connect to Datadog MCP", err);
  }
}

async function closeDatadogMcpSession(session: DatadogMcpSession): Promise<void> {
  await session.transport.close().catch(() => undefined);
}

export async function withDatadogMcpSession<T>(fn: (session: DatadogMcpSession) => Promise<T>): Promise<T | string> {
  const session = await connectDatadogMcpSession();
  if (typeof session === "string") return session;
  try {
    return await fn(session);
  } finally {
    await closeDatadogMcpSession(session);
  }
}

export async function callDatadogMcpTool(session: DatadogMcpSession, name: string, args: Record<string, unknown>) {
  try {
    return await session.client.callTool({ name, arguments: args });
  } catch (err) {
    return formatErrorMessage(`Datadog MCP tool ${name} failed`, err);
  }
}

export function parseDatadogMcpJson(result: unknown): unknown | string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return "Datadog MCP returned an unexpected response.";

  if (result.isError === true) {
    const message = extractFirstText(result.content);
    return message || "Datadog MCP returned an error.";
  }

  const text = extractFirstText(result.content);
  if (!text) return "Datadog MCP returned no text content.";

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractFirstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const entry = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (!entry || !isRecord(entry)) return undefined;
  return typeof entry.text === "string" ? entry.text : undefined;
}

function normaliseToolText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreTool(tool: DatadogMcpTool, requiredTerms: string[], optionalTerms: string[]): number {
  const haystack = `${normaliseToolText(tool.name)} ${normaliseToolText(tool.description)}`.trim();
  if (!haystack) return -1;
  if (requiredTerms.some((term) => !haystack.includes(term))) return -1;

  let score = 0;
  for (const term of requiredTerms) {
    if (normaliseToolText(tool.name).includes(term)) score += 5;
    else score += 2;
  }
  for (const term of optionalTerms) {
    if (haystack.includes(term)) score += normaliseToolText(tool.name).includes(term) ? 3 : 1;
  }
  return score;
}

type DatadogToolCapability = "metricsQuery" | "logsSearch" | "metricsCatalog";

export function resolveDatadogMcpTool(
  session: Pick<DatadogMcpSession, "tools" | "toolNames">,
  capability: DatadogToolCapability,
): string | undefined {
  const exactAliases: Record<DatadogToolCapability, string[]> = {
    metricsQuery: ["query-metrics", "get_datadog_metric", "query_datadog_metrics"],
    logsSearch: ["search-logs", "search_datadog_logs"],
    metricsCatalog: ["get-metrics", "list_datadog_metrics", "search_datadog_metrics"],
  };

  for (const alias of exactAliases[capability]) {
    if (session.toolNames.includes(alias)) return alias;
  }

  const heuristics: Record<DatadogToolCapability, { requiredTerms: string[]; optionalTerms: string[] }> = {
    metricsQuery: { requiredTerms: ["metric"], optionalTerms: ["query", "timeseries", "measure", "point", "value"] },
    logsSearch: { requiredTerms: ["log"], optionalTerms: ["search", "query", "events"] },
    metricsCatalog: { requiredTerms: ["metric"], optionalTerms: ["list", "catalog", "search", "discover"] },
  };

  return session.tools
    .map((tool) => ({
      tool,
      score: scoreTool(tool, heuristics[capability].requiredTerms, heuristics[capability].optionalTerms),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))[0]?.tool.name;
}

export async function getDatadogMcpToolNames(): Promise<string[] | string> {
  return withDatadogMcpSession(async (session) => session.toolNames);
}
