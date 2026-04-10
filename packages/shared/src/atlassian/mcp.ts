import {
  callMcpTool,
  clearMcpOauthState,
  getMcpAuthStatus,
  getMcpOauthStatePath,
  type LoginCallbacks,
  loginWithMcpOauth,
  type McpAuthState,
  type McpConfig,
  type McpLoginResult,
  type McpOauthDeps,
  type McpSession,
  type McpTool,
  parseMcpJson,
  readMcpOauthState,
  resolveMcpTool,
  withMcpSession,
  writeMcpOauthState,
} from "../mcp/index.js";

export interface AtlassianMcpConfig extends McpConfig {
  siteUrl?: string;
}

export interface AtlassianMcpAuthState extends McpAuthState {}

export interface AtlassianMcpLoginResult extends McpLoginResult {}

export interface AtlassianMcpTool extends McpTool {}

export interface AtlassianMcpSession extends McpSession {}

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:33389/callback";
const DEFAULT_CLIENT_NAME = "Forgeflow Atlassian MCP";

function normaliseOrigin(input: string): string {
  return new URL(input).origin;
}

export function isAtlassianMcpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ATLASSIAN_MCP_URL?.trim());
}

export function getAtlassianMcpConfig(env: NodeJS.ProcessEnv = process.env): AtlassianMcpConfig | string {
  const serverUrl = env.ATLASSIAN_MCP_URL?.trim();
  const redirectUri = env.ATLASSIAN_MCP_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const clientName = env.ATLASSIAN_MCP_CLIENT_NAME?.trim() || DEFAULT_CLIENT_NAME;
  const scope = env.ATLASSIAN_MCP_SCOPE?.trim() || env.ATLASSIAN_MCP_SCOPES?.trim() || undefined;
  const clientId = env.ATLASSIAN_MCP_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.ATLASSIAN_MCP_CLIENT_SECRET?.trim() || undefined;
  const clientMetadataUrl = env.ATLASSIAN_MCP_CLIENT_METADATA_URL?.trim() || undefined;

  if (!serverUrl) return "Missing ATLASSIAN_MCP_URL. Set it to your Atlassian MCP server URL.";

  try {
    new URL(serverUrl);
  } catch {
    return `Invalid ATLASSIAN_MCP_URL: ${serverUrl}`;
  }

  try {
    new URL(redirectUri);
  } catch {
    return `Invalid ATLASSIAN_MCP_REDIRECT_URI: ${redirectUri}`;
  }

  if (clientMetadataUrl) {
    try {
      const parsed = new URL(clientMetadataUrl);
      if (parsed.protocol !== "https:") {
        return `Invalid ATLASSIAN_MCP_CLIENT_METADATA_URL: ${clientMetadataUrl}. It must use https.`;
      }
    } catch {
      return `Invalid ATLASSIAN_MCP_CLIENT_METADATA_URL: ${clientMetadataUrl}`;
    }
  }

  let siteUrl: string | undefined;
  if (env.ATLASSIAN_URL?.trim()) {
    try {
      siteUrl = normaliseOrigin(env.ATLASSIAN_URL.trim());
    } catch {
      return `Invalid ATLASSIAN_URL: ${env.ATLASSIAN_URL}`;
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
    siteUrl,
  };
}

export function getAtlassianMcpOauthStatePath(): string {
  return getMcpOauthStatePath("atlassian");
}

export async function readAtlassianMcpOauthState(): Promise<AtlassianMcpAuthState | null> {
  return readMcpOauthState(getAtlassianMcpOauthStatePath());
}

export async function writeAtlassianMcpOauthState(state: AtlassianMcpAuthState): Promise<void> {
  await writeMcpOauthState(getAtlassianMcpOauthStatePath(), state);
}

export async function clearAtlassianMcpOauthState(): Promise<void> {
  await clearMcpOauthState(getAtlassianMcpOauthStatePath());
}

export async function loginWithAtlassianMcpOauth(
  callbacks: LoginCallbacks = {},
  deps?: McpOauthDeps,
): Promise<AtlassianMcpLoginResult | string> {
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  return loginWithMcpOauth(
    config,
    {
      statePath: getAtlassianMcpOauthStatePath(),
      serviceLabel: "Atlassian MCP",
      loginClientName: "forgeflow-atlassian-login",
    },
    callbacks,
    deps,
  );
}

export async function getAtlassianMcpAuthStatus(): Promise<
  | {
      configured: true;
      authenticated: boolean;
      serverUrl: string;
      hasRefreshToken: boolean;
      tokenType?: string;
    }
  | string
> {
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  return getMcpAuthStatus(config, getAtlassianMcpOauthStatePath());
}

export async function withAtlassianMcpSession<T>(
  fn: (session: AtlassianMcpSession) => Promise<T>,
): Promise<T | string> {
  const config = getAtlassianMcpConfig();
  if (typeof config === "string") return config;

  return withMcpSession(
    config,
    getAtlassianMcpOauthStatePath(),
    {
      serviceLabel: "Atlassian MCP",
      loginCommand: "atlassian-login",
      sessionClientName: "forgeflow-atlassian-mcp",
    },
    fn,
  );
}

export async function callAtlassianMcpTool(session: AtlassianMcpSession, name: string, args: Record<string, unknown>) {
  return callMcpTool(session, name, args, "Atlassian MCP");
}

export function parseAtlassianMcpJson(result: unknown): unknown | string {
  return parseMcpJson(result, "Atlassian MCP");
}

type AtlassianToolCapability = "jiraGetIssue" | "confluenceGetPage" | "jiraCreateIssue" | "accessibleResources";

export function resolveAtlassianMcpTool(
  session: Pick<AtlassianMcpSession, "tools" | "toolNames">,
  capability: AtlassianToolCapability,
): string | undefined {
  const exactAliases: Record<AtlassianToolCapability, string[]> = {
    jiraGetIssue: [
      "get-jira-issue",
      "jira-get-issue",
      "get_jira_issue",
      "jira_get_issue",
      "getJiraIssue",
      "read-jira-issue",
    ],
    confluenceGetPage: [
      "get-confluence-page",
      "confluence-get-page",
      "get_confluence_page",
      "confluence_get_page",
      "getConfluencePage",
      "read-confluence-page",
    ],
    jiraCreateIssue: [
      "create-jira-issue",
      "jira-create-issue",
      "create_jira_issue",
      "jira_create_issue",
      "createJiraIssue",
    ],
    accessibleResources: [
      "get-accessible-atlassian-resources",
      "get-accessible-resources",
      "accessible-atlassian-resources",
      "getAccessibleAtlassianResources",
      "getAccessibleResources",
      "listAccessibleAtlassianResources",
    ],
  };

  const heuristics: Record<AtlassianToolCapability, { requiredTerms: string[]; optionalTerms: string[] }> = {
    jiraGetIssue: { requiredTerms: ["jira"], optionalTerms: ["issue", "ticket", "read", "fetch", "get"] },
    confluenceGetPage: {
      requiredTerms: ["confluence"],
      optionalTerms: ["page", "content", "read", "fetch", "get"],
    },
    jiraCreateIssue: { requiredTerms: ["jira"], optionalTerms: ["issue", "ticket", "create", "write"] },
    accessibleResources: {
      requiredTerms: ["accessible"],
      optionalTerms: ["resource", "resources", "atlassian", "site", "cloud"],
    },
  };

  return resolveMcpTool(
    session,
    exactAliases[capability],
    heuristics[capability].requiredTerms,
    heuristics[capability].optionalTerms,
  );
}
