import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpAuthState } from "../types.js";

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
