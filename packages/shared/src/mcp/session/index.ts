import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StoredMcpOAuthProvider } from "../auth/provider.js";
import { readMcpOauthState } from "../auth/state.js";
import type { McpClientLike, McpConfig, McpSession, McpSessionDeps, McpTool } from "../types.js";

interface McpSessionOptions {
  serviceLabel: string;
  loginCommand: string;
  sessionClientName: string;
}

function formatErrorMessage(prefix: string, err: unknown): string {
  return `${prefix}: ${(err as Error).message}`;
}

export async function fetchTools(client: McpClientLike): Promise<McpTool[]> {
  const tools = await client.listTools();
  return tools.tools
    .map((tool) => ({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function connectMcpSession(
  config: McpConfig,
  statePath: string,
  options: McpSessionOptions,
  deps: McpSessionDeps = {},
): Promise<McpSession | string> {
  const state = await readMcpOauthState(statePath);
  if (!state?.tokens?.access_token) {
    return `${options.serviceLabel} is configured but no login was found. Run /${options.loginCommand}.`;
  }

  const provider = new StoredMcpOAuthProvider(config, statePath, state, () => undefined);
  const client = deps.createClientFn
    ? deps.createClientFn()
    : new Client({ name: options.sessionClientName, version: "1.0.0" }, { capabilities: {} });
  const transport = deps.createTransportFn
    ? deps.createTransportFn(config, provider)
    : new StreamableHTTPClientTransport(new URL(config.serverUrl), { authProvider: provider });

  try {
    await client.connect(transport);
    const tools = await fetchTools(client);
    return {
      client: client as unknown as McpSession["client"],
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

async function closeMcpSession(session: Pick<McpSession, "transport">): Promise<void> {
  await session.transport.close().catch(() => undefined);
}

export async function withMcpSession<T>(
  config: McpConfig,
  statePath: string,
  options: McpSessionOptions,
  fn: (session: McpSession) => Promise<T>,
  deps: McpSessionDeps = {},
): Promise<T | string> {
  const session = await connectMcpSession(config, statePath, options, deps);
  if (typeof session === "string") return session;
  try {
    return await fn(session);
  } finally {
    await closeMcpSession(session);
  }
}
