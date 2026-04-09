import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDatadogMcpConfig, readDatadogMcpOauthState, writeDatadogMcpOauthState } from "./oauth.js";

export interface DatadogMcpSession {
  client: Client;
  transport: StreamableHTTPClientTransport;
  serverUrl: string;
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
    return {
      client,
      transport,
      serverUrl: config.serverUrl,
      toolNames: tools.tools.map((tool: { name: string }) => tool.name).sort(),
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

export async function getDatadogMcpToolNames(): Promise<string[] | string> {
  return withDatadogMcpSession(async (session) => session.toolNames);
}
