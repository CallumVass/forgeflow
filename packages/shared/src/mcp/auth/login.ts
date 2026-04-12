import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fetchTools } from "../session/index.js";
import type { LoginCallbacks, McpAuthStatus, McpConfig, McpLoginResult, McpOauthDeps } from "../types.js";
import { waitForOauthCallback } from "./callback-server.js";
import { StoredMcpOAuthProvider } from "./provider.js";
import { readMcpOauthState } from "./state.js";

interface McpLoginOptions {
  statePath: string;
  serviceLabel: string;
  loginClientName: string;
}

function createLoginSession(
  config: McpConfig,
  provider: StoredMcpOAuthProvider,
  options: McpLoginOptions,
  deps?: McpOauthDeps,
) {
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
  options: McpLoginOptions,
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
