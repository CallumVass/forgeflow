import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface DatadogMcpConfig {
  serverUrl: string;
  redirectUri: string;
  clientName: string;
  scope?: string;
  clientId?: string;
  clientSecret?: string;
  clientMetadataUrl?: string;
}

export interface DatadogMcpAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

interface DatadogMcpOauthDeps {
  now?: () => number;
}

interface LoginCallbacks {
  onStatus?: (text: string) => void;
  onAuthUrl?: (url: string) => void;
}

export interface DatadogMcpLoginResult {
  serverUrl: string;
  toolNames: string[];
}

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:33390/callback";
const DEFAULT_CLIENT_NAME = "Forgeflow Datadog MCP";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOauthTokens(value: unknown): value is OAuthTokens {
  if (!isRecord(value)) return false;
  return typeof value.access_token === "string" && typeof value.token_type === "string";
}

function isOauthClientInformation(value: unknown): value is OAuthClientInformationMixed {
  if (!isRecord(value)) return false;
  return typeof value.client_id === "string";
}

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
  return path.join(os.homedir(), ".pi", "agent", "forgeflow-datadog-mcp-oauth.json");
}

export async function readDatadogMcpOauthState(): Promise<DatadogMcpAuthState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(getDatadogMcpOauthStatePath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return null;

  const state: DatadogMcpAuthState = {};
  if (isOauthClientInformation(parsed.clientInformation)) state.clientInformation = parsed.clientInformation;
  if (isOauthTokens(parsed.tokens)) state.tokens = parsed.tokens;
  if (typeof parsed.codeVerifier === "string") state.codeVerifier = parsed.codeVerifier;
  if (isRecord(parsed.discoveryState) && typeof parsed.discoveryState.authorizationServerUrl === "string") {
    state.discoveryState = parsed.discoveryState as unknown as OAuthDiscoveryState;
  }
  return state;
}

export async function writeDatadogMcpOauthState(state: DatadogMcpAuthState): Promise<void> {
  const statePath = getDatadogMcpOauthStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export async function clearDatadogMcpOauthState(): Promise<void> {
  try {
    await fs.unlink(getDatadogMcpOauthStatePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

class StoredDatadogMcpOAuthProvider implements OAuthClientProvider {
  private authState: DatadogMcpAuthState;
  readonly clientMetadataUrl?: string;

  constructor(
    private readonly config: DatadogMcpConfig,
    initialState: DatadogMcpAuthState,
    private readonly redirectFn: (url: URL) => void,
  ) {
    this.authState = initialState;
    this.clientMetadataUrl = config.clientMetadataUrl;
  }

  get redirectUrl(): string {
    return this.config.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.clientName,
      redirect_uris: [this.config.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.authState.clientInformation) return this.authState.clientInformation;
    if (!this.config.clientId) return undefined;
    return {
      client_id: this.config.clientId,
      ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}),
      ...(this.config.clientSecret ? { token_endpoint_auth_method: "client_secret_post" as const } : {}),
    };
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.authState.clientInformation = clientInformation;
    await writeDatadogMcpOauthState(this.authState);
  }

  tokens(): OAuthTokens | undefined {
    return this.authState.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.authState.tokens = tokens;
    await writeDatadogMcpOauthState(this.authState);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.redirectFn(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.authState.codeVerifier = codeVerifier;
    await writeDatadogMcpOauthState(this.authState);
  }

  codeVerifier(): string {
    if (!this.authState.codeVerifier) throw new Error("No OAuth code verifier saved for Datadog MCP login.");
    return this.authState.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") delete this.authState.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.authState.tokens;
    if (scope === "all" || scope === "verifier") delete this.authState.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.authState.discoveryState;
    await writeDatadogMcpOauthState(this.authState);
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    this.authState.discoveryState = discoveryState;
    await writeDatadogMcpOauthState(this.authState);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.authState.discoveryState;
  }
}

async function waitForOauthCallback(redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const callbackUrl = new URL(redirectUri);
    const hostname = callbackUrl.hostname;
    const pathname = callbackUrl.pathname || "/";
    const port = callbackUrl.port ? parseInt(callbackUrl.port, 10) : callbackUrl.protocol === "https:" ? 443 : 80;
    const timeout = setTimeout(() => {
      server.close(() => reject(new Error("Timed out waiting for the Datadog MCP OAuth callback.")));
    }, 5 * 60_000);

    const finish = (err?: Error, code?: string) => {
      clearTimeout(timeout);
      server.close(() => {
        if (err) reject(err);
        else if (code) resolve(code);
        else reject(new Error("Datadog MCP OAuth callback completed without an authorisation code."));
      });
    };

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing callback URL.");
        return;
      }

      const incoming = new URL(req.url, `${callbackUrl.protocol}//${callbackUrl.host}`);
      if (incoming.pathname !== pathname) {
        res.statusCode = 404;
        res.end("Not found.");
        return;
      }

      const error = incoming.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.end("Datadog MCP OAuth failed. You can close this tab.");
        finish(new Error(`Datadog MCP OAuth failed: ${error}`));
        return;
      }

      const code = incoming.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end("Datadog MCP OAuth callback did not include a code.");
        finish(new Error("Datadog MCP OAuth callback did not include a code."));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        "<html><body><h1>Forgeflow connected to Datadog MCP.</h1><p>You can close this tab and return to Pi.</p></body></html>",
      );
      finish(undefined, code);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.listen(port, hostname);
  });
}

async function fetchToolNames(client: Client): Promise<string[]> {
  const tools = await client.listTools();
  return tools.tools.map((tool: { name: string }) => tool.name).sort();
}

async function connectClient(client: Client, transport: StreamableHTTPClientTransport): Promise<void> {
  await client.connect(transport);
}

export async function loginWithDatadogMcpOauth(
  callbacks: LoginCallbacks = {},
  _deps?: DatadogMcpOauthDeps,
): Promise<DatadogMcpLoginResult | string> {
  const config = getDatadogMcpConfig();
  if (typeof config === "string") return config;

  const initialState = (await readDatadogMcpOauthState()) ?? {};
  const provider = new StoredDatadogMcpOAuthProvider(config, initialState, (url) =>
    callbacks.onAuthUrl?.(url.toString()),
  );
  const client = new Client({ name: "forgeflow-datadog-login", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl), { authProvider: provider });

  callbacks.onStatus?.("Connecting to Datadog MCP...");
  try {
    await connectClient(client, transport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      await transport.close().catch(() => undefined);
      return `Datadog MCP login failed: ${(err as Error).message}`;
    }

    callbacks.onStatus?.("Waiting for Datadog MCP authorisation...");
    const codePromise = waitForOauthCallback(config.redirectUri);
    let code: string;
    try {
      code = await codePromise;
    } catch (callbackErr) {
      await transport.close().catch(() => undefined);
      return `Datadog MCP login failed: ${(callbackErr as Error).message}`;
    }

    callbacks.onStatus?.("Exchanging Datadog MCP authorisation code...");
    try {
      await transport.finishAuth(code);
      await connectClient(client, transport);
    } catch (finishErr) {
      await transport.close().catch(() => undefined);
      return `Datadog MCP login failed: ${(finishErr as Error).message}`;
    }
  }

  callbacks.onStatus?.("Loading Datadog MCP tools...");
  try {
    const toolNames = await fetchToolNames(client);
    await transport.close().catch(() => undefined);
    callbacks.onStatus?.("Datadog MCP login complete.");
    return { serverUrl: config.serverUrl, toolNames };
  } catch (err) {
    await transport.close().catch(() => undefined);
    return `Datadog MCP login failed: ${(err as Error).message}`;
  }
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

  const state = await readDatadogMcpOauthState();
  const tokens = state?.tokens;
  return {
    configured: true,
    authenticated: Boolean(tokens?.access_token),
    serverUrl: config.serverUrl,
    hasRefreshToken: typeof tokens?.refresh_token === "string" && tokens.refresh_token.length > 0,
    tokenType: tokens?.token_type,
  };
}
