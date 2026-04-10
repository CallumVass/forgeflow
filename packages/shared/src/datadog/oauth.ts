import {
  clearMcpOauthState,
  getMcpAuthStatus,
  getMcpOauthStatePath,
  type LoginCallbacks,
  loginWithMcpOauth,
  type McpAuthState,
  type McpConfig,
  type McpLoginResult,
  type McpOauthDeps,
  readMcpOauthState,
  writeMcpOauthState,
} from "../mcp/index.js";

export interface DatadogMcpConfig extends McpConfig {}

export interface DatadogMcpAuthState extends McpAuthState {}

export interface DatadogMcpLoginResult extends McpLoginResult {}

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:33390/callback";
const DEFAULT_CLIENT_NAME = "Forgeflow Datadog MCP";

function normaliseOrigin(input: string): string {
  return new URL(input).toString();
}

export function getDatadogMcpConfig(env: NodeJS.ProcessEnv = process.env): DatadogMcpConfig | string {
  const serverUrl = env.DATADOG_MCP_URL?.trim();
  const redirectUri = env.DATADOG_MCP_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const clientName = env.DATADOG_MCP_CLIENT_NAME?.trim() || DEFAULT_CLIENT_NAME;
  const scope = env.DATADOG_MCP_SCOPE?.trim() || env.DATADOG_MCP_SCOPES?.trim() || undefined;
  const clientId = env.DATADOG_MCP_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.DATADOG_MCP_CLIENT_SECRET?.trim() || undefined;
  const clientMetadataUrl = env.DATADOG_MCP_CLIENT_METADATA_URL?.trim() || undefined;

  if (!serverUrl) return "Missing DATADOG_MCP_URL. Set it to your Datadog MCP server URL.";

  try {
    normaliseOrigin(serverUrl);
  } catch {
    return `Invalid DATADOG_MCP_URL: ${serverUrl}`;
  }

  try {
    new URL(redirectUri);
  } catch {
    return `Invalid DATADOG_MCP_REDIRECT_URI: ${redirectUri}`;
  }

  if (clientMetadataUrl) {
    try {
      const parsed = new URL(clientMetadataUrl);
      if (parsed.protocol !== "https:") {
        return `Invalid DATADOG_MCP_CLIENT_METADATA_URL: ${clientMetadataUrl}. It must use https.`;
      }
    } catch {
      return `Invalid DATADOG_MCP_CLIENT_METADATA_URL: ${clientMetadataUrl}`;
    }
  }

  return {
    serverUrl,
    redirectUri,
    clientName,
    scope,
    clientId,
    clientSecret,
    clientMetadataUrl,
  };
}

export function getDatadogMcpOauthStatePath(): string {
  return getMcpOauthStatePath("datadog");
}

export async function readDatadogMcpOauthState(): Promise<DatadogMcpAuthState | null> {
  return readMcpOauthState(getDatadogMcpOauthStatePath());
}

export async function writeDatadogMcpOauthState(state: DatadogMcpAuthState): Promise<void> {
  await writeMcpOauthState(getDatadogMcpOauthStatePath(), state);
}

export async function clearDatadogMcpOauthState(): Promise<void> {
  await clearMcpOauthState(getDatadogMcpOauthStatePath());
}

export async function loginWithDatadogMcpOauth(
  callbacks: LoginCallbacks = {},
  deps?: McpOauthDeps,
): Promise<DatadogMcpLoginResult | string> {
  const config = getDatadogMcpConfig();
  if (typeof config === "string") return config;

  return loginWithMcpOauth(
    config,
    {
      statePath: getDatadogMcpOauthStatePath(),
      serviceLabel: "Datadog MCP",
      loginClientName: "forgeflow-datadog-login",
    },
    callbacks,
    deps,
  );
}

export async function getDatadogMcpAuthStatus(): Promise<
  | {
      configured: true;
      authenticated: boolean;
      serverUrl: string;
      hasRefreshToken: boolean;
      tokenType?: string;
    }
  | string
> {
  const config = getDatadogMcpConfig();
  if (typeof config === "string") return config;

  return getMcpAuthStatus(config, getDatadogMcpOauthStatePath());
}
