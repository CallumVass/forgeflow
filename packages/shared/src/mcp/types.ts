import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
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

export interface McpAuthStatus {
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

export interface McpClientLike {
  connect(transport: Transport): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string }> }>;
}

export interface McpSessionClientLike extends McpClientLike {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

export interface McpTransportLike extends Transport {
  finishAuth(code: string): Promise<void>;
}

export interface McpOauthDeps {
  createClientFn?: () => McpClientLike;
  createTransportFn?: (config: McpConfig, provider: OAuthClientProvider) => McpTransportLike;
  waitForOauthCallbackFn?: (redirectUri: string) => Promise<string>;
}

export interface McpSessionDeps {
  createClientFn?: () => McpSessionClientLike;
  createTransportFn?: (config: McpConfig, provider: OAuthClientProvider) => StreamableHTTPClientTransport;
}
