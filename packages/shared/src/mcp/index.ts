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
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpConfig {
  serverUrl: string;
  redirectUri: string;
  clientName: string;
  scope?: string;
  clientId?: string;
  clientSecret?: string;
  clientMetadataUrl?: string;
}

export interface McpAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpSession {
  client: Client;
  transport: StreamableHTTPClientTransport;
  serverUrl: string;
  tools: McpTool[];
  toolNames: string[];
}

export interface McpLoginResult {
  serverUrl: string;
  toolNames: string[];
}

interface McpAuthStatus {
  configured: true;
  authenticated: boolean;
  serverUrl: string;
  hasRefreshToken: boolean;
  tokenType?: string;
}

export interface LoginCallbacks {
  onStatus?: (text: string) => void;
  onAuthUrl?: (url: string) => void;
}

interface McpClientLike {
  connect(transport: Transport): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string }> }>;
}

interface McpTransportLike extends Transport {
  finishAuth(code: string): Promise<void>;
}

export interface McpOauthDeps {
  createClientFn?: () => McpClientLike;
  createTransportFn?: (config: McpConfig, provider: OAuthClientProvider) => McpTransportLike;
  waitForOauthCallbackFn?: (redirectUri: string) => Promise<string>;
}

interface SessionOptions {
  serviceLabel: string;
  loginCommand: string;
  sessionClientName: string;
}

interface LoginOptions {
  statePath: string;
  serviceLabel: string;
  loginClientName: string;
}

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

function formatErrorMessage(prefix: string, err: unknown): string {
  return `${prefix}: ${(err as Error).message}`;
}

export function getMcpOauthStatePath(integration: string): string {
  return path.join(os.homedir(), ".pi", "agent", `forgeflow-${integration}-mcp-oauth.json`);
}

export async function readMcpOauthState(statePath: string): Promise<McpAuthState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return null;

  const state: McpAuthState = {};
  if (isOauthClientInformation(parsed.clientInformation)) state.clientInformation = parsed.clientInformation;
  if (isOauthTokens(parsed.tokens)) state.tokens = parsed.tokens;
  if (typeof parsed.codeVerifier === "string") state.codeVerifier = parsed.codeVerifier;
  if (isRecord(parsed.discoveryState) && typeof parsed.discoveryState.authorizationServerUrl === "string") {
    state.discoveryState = parsed.discoveryState as unknown as OAuthDiscoveryState;
  }
  return state;
}

export async function writeMcpOauthState(statePath: string, state: McpAuthState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export async function clearMcpOauthState(statePath: string): Promise<void> {
  try {
    await fs.unlink(statePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

class StoredMcpOAuthProvider implements OAuthClientProvider {
  private authState: McpAuthState;
  readonly clientMetadataUrl?: string;

  constructor(
    private readonly config: McpConfig,
    private readonly statePath: string,
    initialState: McpAuthState,
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
    await writeMcpOauthState(this.statePath, this.authState);
  }

  tokens(): OAuthTokens | undefined {
    return this.authState.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.authState.tokens = tokens;
    await writeMcpOauthState(this.statePath, this.authState);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.redirectFn(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.authState.codeVerifier = codeVerifier;
    await writeMcpOauthState(this.statePath, this.authState);
  }

  codeVerifier(): string {
    if (!this.authState.codeVerifier) throw new Error(`No OAuth code verifier saved for ${this.config.clientName}.`);
    return this.authState.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") delete this.authState.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.authState.tokens;
    if (scope === "all" || scope === "verifier") delete this.authState.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.authState.discoveryState;
    await writeMcpOauthState(this.statePath, this.authState);
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    this.authState.discoveryState = discoveryState;
    await writeMcpOauthState(this.statePath, this.authState);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.authState.discoveryState;
  }
}

async function waitForOauthCallback(redirectUri: string, serviceLabel: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const callbackUrl = new URL(redirectUri);
    const hostname = callbackUrl.hostname;
    const pathname = callbackUrl.pathname || "/";
    const port = callbackUrl.port ? parseInt(callbackUrl.port, 10) : callbackUrl.protocol === "https:" ? 443 : 80;
    const timeout = setTimeout(() => {
      server.close(() => reject(new Error(`Timed out waiting for the ${serviceLabel} OAuth callback.`)));
    }, 5 * 60_000);

    const finish = (err?: Error, code?: string) => {
      clearTimeout(timeout);
      server.close(() => {
        if (err) reject(err);
        else if (code) resolve(code);
        else reject(new Error(`${serviceLabel} OAuth callback completed without an authorisation code.`));
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
        res.end(`${serviceLabel} OAuth failed. You can close this tab.`);
        finish(new Error(`${serviceLabel} OAuth failed: ${error}`));
        return;
      }

      const code = incoming.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end(`${serviceLabel} OAuth callback did not include a code.`);
        finish(new Error(`${serviceLabel} OAuth callback did not include a code.`));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<html><body><h1>Forgeflow connected to ${serviceLabel}.</h1><p>You can close this tab and return to Pi.</p></body></html>`,
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

async function fetchTools(client: McpClientLike): Promise<McpTool[]> {
  const tools = await client.listTools();
  return tools.tools
    .map((tool) => ({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createLoginSession(
  config: McpConfig,
  provider: StoredMcpOAuthProvider,
  options: LoginOptions,
  deps?: McpOauthDeps,
): { client: McpClientLike; transport: McpTransportLike } {
  const client = deps?.createClientFn
    ? deps.createClientFn()
    : new Client({ name: options.loginClientName, version: "1.0.0" }, { capabilities: {} });
  const transport = deps?.createTransportFn
    ? deps.createTransportFn(config, provider)
    : new StreamableHTTPClientTransport(new URL(config.serverUrl), { authProvider: provider });
  return { client, transport };
}

export async function loginWithMcpOauth(
  config: McpConfig,
  options: LoginOptions,
  callbacks: LoginCallbacks = {},
  deps?: McpOauthDeps,
): Promise<McpLoginResult | string> {
  const initialState = (await readMcpOauthState(options.statePath)) ?? {};
  const provider = new StoredMcpOAuthProvider(config, options.statePath, initialState, (url) =>
    callbacks.onAuthUrl?.(url.toString()),
  );
  const waitForCallback =
    deps?.waitForOauthCallbackFn ?? ((redirectUri: string) => waitForOauthCallback(redirectUri, options.serviceLabel));

  let session = createLoginSession(config, provider, options, deps);

  callbacks.onStatus?.(`Connecting to ${options.serviceLabel}...`);
  try {
    await session.client.connect(session.transport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      await session.transport.close().catch(() => undefined);
      return `${options.serviceLabel} login failed: ${(err as Error).message}`;
    }

    callbacks.onStatus?.(`Waiting for ${options.serviceLabel} authorisation...`);
    let code: string;
    try {
      code = await waitForCallback(config.redirectUri);
    } catch (callbackErr) {
      await session.transport.close().catch(() => undefined);
      return `${options.serviceLabel} login failed: ${(callbackErr as Error).message}`;
    }

    callbacks.onStatus?.(`Exchanging ${options.serviceLabel} authorisation code...`);
    try {
      await session.transport.finishAuth(code);
      await session.transport.close().catch(() => undefined);
      session = createLoginSession(config, provider, options, deps);
      callbacks.onStatus?.(`Reconnecting to ${options.serviceLabel}...`);
      await session.client.connect(session.transport);
    } catch (finishErr) {
      await session.transport.close().catch(() => undefined);
      return `${options.serviceLabel} login failed: ${(finishErr as Error).message}`;
    }
  }

  callbacks.onStatus?.(`Loading ${options.serviceLabel} tools...`);
  try {
    const tools = await fetchTools(session.client);
    await session.transport.close().catch(() => undefined);
    callbacks.onStatus?.(`${options.serviceLabel} login complete.`);
    return { serverUrl: config.serverUrl, toolNames: tools.map((tool) => tool.name) };
  } catch (err) {
    await session.transport.close().catch(() => undefined);
    return `${options.serviceLabel} login failed: ${(err as Error).message}`;
  }
}

export async function getMcpAuthStatus(config: McpConfig, statePath: string): Promise<McpAuthStatus> {
  const state = await readMcpOauthState(statePath);
  const tokens = state?.tokens;
  return {
    configured: true,
    authenticated: Boolean(tokens?.access_token),
    serverUrl: config.serverUrl,
    hasRefreshToken: typeof tokens?.refresh_token === "string" && tokens.refresh_token.length > 0,
    tokenType: tokens?.token_type,
  };
}

async function connectMcpSession(
  config: McpConfig,
  statePath: string,
  options: SessionOptions,
): Promise<McpSession | string> {
  const state = await readMcpOauthState(statePath);
  if (!state?.tokens?.access_token) {
    return `${options.serviceLabel} is configured but no login was found. Run /${options.loginCommand}.`;
  }

  const provider = new StoredMcpOAuthProvider(config, statePath, state, () => undefined);
  const client = new Client({ name: options.sessionClientName, version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl), { authProvider: provider });

  try {
    await client.connect(transport);
    const tools = await fetchTools(client);
    return {
      client,
      transport,
      serverUrl: config.serverUrl,
      tools,
      toolNames: tools.map((tool) => tool.name),
    };
  } catch (err) {
    await transport.close().catch(() => undefined);
    if (err instanceof UnauthorizedError) {
      return `${options.serviceLabel} authorisation has expired or is missing. Run /${options.loginCommand}.`;
    }
    return formatErrorMessage(`Failed to connect to ${options.serviceLabel}`, err);
  }
}

async function closeMcpSession(session: McpSession): Promise<void> {
  await session.transport.close().catch(() => undefined);
}

export async function withMcpSession<T>(
  config: McpConfig,
  statePath: string,
  options: SessionOptions,
  fn: (session: McpSession) => Promise<T>,
): Promise<T | string> {
  const session = await connectMcpSession(config, statePath, options);
  if (typeof session === "string") return session;
  try {
    return await fn(session);
  } finally {
    await closeMcpSession(session);
  }
}

export async function callMcpTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
  serviceLabel: string,
) {
  try {
    return await session.client.callTool({ name, arguments: args });
  } catch (err) {
    return formatErrorMessage(`${serviceLabel} tool ${name} failed`, err);
  }
}

export function parseMcpJson(result: unknown, serviceLabel: string): unknown | string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return `${serviceLabel} returned an unexpected response.`;

  if (result.isError === true) {
    const message = extractFirstText(result.content);
    return message || `${serviceLabel} returned an error.`;
  }

  const text = extractFirstText(result.content);
  if (!text) return `${serviceLabel} returned no text content.`;

  return parseStructuredMcpText(text);
}

function parseStructuredMcpText(text: string): unknown | string {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Fall through to tagged payload extraction.
  }

  const wrappedJson = extractTaggedBlock(text, "JSON_DATA");
  if (wrappedJson !== undefined) {
    try {
      return JSON.parse(wrappedJson) as unknown;
    } catch {
      return wrappedJson;
    }
  }

  const wrappedYaml = extractTaggedBlock(text, "YAML_DATA");
  if (wrappedYaml !== undefined) {
    const trimmed = wrappedYaml.trim();
    if (!trimmed) return [];
    return trimmed;
  }

  return text;
}

function extractTaggedBlock(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match?.[1]?.trim();
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

function scoreTool(
  tool: McpTool,
  requiredTerms: string[],
  optionalTerms: string[],
  options: { requireOptionalMatch?: boolean } = {},
): number {
  const haystack = `${normaliseToolText(tool.name)} ${normaliseToolText(tool.description)}`.trim();
  if (!haystack) return -1;
  if (requiredTerms.some((term) => !haystack.includes(term))) return -1;

  const optionalMatches = optionalTerms.filter((term) => haystack.includes(term)).length;
  if (options.requireOptionalMatch && optionalMatches === 0) return -1;

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

export function resolveMcpTool(
  session: Pick<McpSession, "tools" | "toolNames">,
  aliases: string[],
  requiredTerms: string[],
  optionalTerms: string[],
  options: { requireOptionalMatch?: boolean } = {},
): string | undefined {
  for (const alias of aliases) {
    if (session.toolNames.includes(alias)) return alias;
  }

  return session.tools
    .map((tool) => ({ tool, score: scoreTool(tool, requiredTerms, optionalTerms, options) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))[0]?.tool.name;
}
