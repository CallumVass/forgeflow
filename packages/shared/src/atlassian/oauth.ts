import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

export interface AtlassianOauthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  siteUrl?: string;
}

export interface AtlassianOauthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AtlassianAccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface AtlassianOauthDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  randomBytesFn?: (size: number) => Buffer;
}

interface LoginCallbacks {
  onStatus?: (text: string) => void;
  onAuthUrl?: (url: string) => void;
}

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:33389/callback";
const DEFAULT_SCOPES = [
  "offline_access",
  "read:jira-work",
  "write:jira-work",
  "read:confluence-content.all",
  "read:page:confluence",
  "read:content.metadata:confluence",
  "read:content-details:confluence",
  "read:space:confluence",
];
const EXPIRY_SKEW_MS = 60_000;

function normaliseOrigin(input: string): string {
  return new URL(input).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? fetch;
}

export function getAtlassianOauthConfig(env: NodeJS.ProcessEnv = process.env): AtlassianOauthConfig | string {
  const clientId = env.ATLASSIAN_CLIENT_ID?.trim();
  const clientSecret = env.ATLASSIAN_CLIENT_SECRET?.trim();
  const redirectUri = env.ATLASSIAN_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const scopes = (env.ATLASSIAN_SCOPES ?? "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (!clientId) return "Missing ATLASSIAN_CLIENT_ID. Set it to your Atlassian OAuth app client ID.";
  if (!clientSecret) return "Missing ATLASSIAN_CLIENT_SECRET. Set it to your Atlassian OAuth app client secret.";

  try {
    new URL(redirectUri);
  } catch {
    return `Invalid ATLASSIAN_REDIRECT_URI: ${redirectUri}`;
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
    clientId,
    clientSecret,
    redirectUri,
    scopes: scopes.length > 0 ? scopes : [...DEFAULT_SCOPES],
    siteUrl,
  };
}

export function getAtlassianOauthTokenPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "forgeflow-atlassian-oauth.json");
}

export async function readAtlassianOauthToken(): Promise<AtlassianOauthToken | null> {
  let raw: string;
  try {
    raw = await fs.readFile(getAtlassianOauthTokenPath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return null;
  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.refreshToken !== "string" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return null;
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
  };
}

export async function writeAtlassianOauthToken(token: AtlassianOauthToken): Promise<void> {
  const tokenPath = getAtlassianOauthTokenPath();
  await fs.mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export async function clearAtlassianOauthToken(): Promise<void> {
  try {
    await fs.unlink(getAtlassianOauthTokenPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function buildAtlassianAuthUrl(config: AtlassianOauthConfig, state: string): string {
  const url = new URL("https://auth.atlassian.com/authorize");
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function parseTokenResponse(response: Response): Promise<TokenResponse | string> {
  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    return `Could not parse Atlassian OAuth response (HTTP ${response.status}).`;
  }

  if (!isRecord(data)) {
    return `Unexpected Atlassian OAuth response (HTTP ${response.status}).`;
  }

  if (!response.ok) {
    const description = typeof data.error_description === "string" ? data.error_description : response.statusText;
    const code = typeof data.error === "string" ? `${data.error}: ` : "";
    return `Atlassian OAuth failed (HTTP ${response.status}): ${code}${description}`;
  }

  return data as TokenResponse;
}

async function exchangeCode(
  code: string,
  config: AtlassianOauthConfig,
  deps?: AtlassianOauthDeps,
): Promise<AtlassianOauthToken | string> {
  const response = await getFetch(deps?.fetchImpl)("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  const parsed = await parseTokenResponse(response);
  if (typeof parsed === "string") return parsed;

  if (!parsed.access_token || !parsed.refresh_token || typeof parsed.expires_in !== "number") {
    return "Atlassian OAuth response was missing access_token, refresh_token, or expires_in.";
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: (deps?.now ?? Date.now)() + parsed.expires_in * 1000,
  };
}

export async function refreshAtlassianOauthToken(
  token: AtlassianOauthToken,
  deps?: AtlassianOauthDeps,
): Promise<AtlassianOauthToken | string> {
  const config = getAtlassianOauthConfig();
  if (typeof config === "string") return config;

  const response = await getFetch(deps?.fetchImpl)("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: token.refreshToken,
    }),
  });

  const parsed = await parseTokenResponse(response);
  if (typeof parsed === "string") return parsed;

  if (!parsed.access_token || typeof parsed.expires_in !== "number") {
    return "Atlassian OAuth refresh response was missing access_token or expires_in.";
  }

  const refreshed = {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? token.refreshToken,
    expiresAt: (deps?.now ?? Date.now)() + parsed.expires_in * 1000,
  };
  await writeAtlassianOauthToken(refreshed);
  return refreshed;
}

export async function getAtlassianAccessToken(deps?: AtlassianOauthDeps): Promise<{ accessToken: string } | string> {
  const token = await readAtlassianOauthToken();
  if (!token) return "Atlassian OAuth is configured but no login was found. Run /atlassian-login.";
  if (token.expiresAt > (deps?.now ?? Date.now)() + EXPIRY_SKEW_MS) return { accessToken: token.accessToken };

  const refreshed = await refreshAtlassianOauthToken(token, deps);
  return typeof refreshed === "string" ? refreshed : { accessToken: refreshed.accessToken };
}

export async function fetchAtlassianAccessibleResources(
  accessToken: string,
  deps?: AtlassianOauthDeps,
): Promise<AtlassianAccessibleResource[] | string> {
  const response = await getFetch(deps?.fetchImpl)("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    return `Could not parse Atlassian accessible-resources response (HTTP ${response.status}).`;
  }

  if (!response.ok) {
    return `Failed to load Atlassian accessible resources (HTTP ${response.status}).`;
  }
  if (!Array.isArray(data)) return "Unexpected Atlassian accessible-resources response.";

  return data
    .filter(isRecord)
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      url: typeof entry.url === "string" ? entry.url : "",
      name: typeof entry.name === "string" ? entry.name : "Atlassian site",
      scopes: Array.isArray(entry.scopes)
        ? entry.scopes.filter((scope): scope is string => typeof scope === "string")
        : [],
    }))
    .filter((entry) => entry.id && entry.url);
}

function waitForOauthCallback(redirectUri: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const callbackUrl = new URL(redirectUri);
    const hostname = callbackUrl.hostname;
    const pathname = callbackUrl.pathname || "/";
    const port = callbackUrl.port ? parseInt(callbackUrl.port, 10) : callbackUrl.protocol === "https:" ? 443 : 80;

    const timer = setTimeout(
      () => {
        server.close(() => reject(new Error("Timed out waiting for the Atlassian OAuth callback.")));
      },
      5 * 60 * 1000,
    );

    const finish = (err?: Error, code?: string) => {
      clearTimeout(timer);
      server.close(() => {
        if (err) reject(err);
        else if (code) resolve(code);
        else reject(new Error("Atlassian OAuth callback completed without an authorisation code."));
      });
    };

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing request URL");
        return;
      }

      const incoming = new URL(req.url, `${callbackUrl.protocol}//${callbackUrl.host}`);
      if (incoming.pathname !== pathname) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const error = incoming.searchParams.get("error");
      const description = incoming.searchParams.get("error_description");
      const state = incoming.searchParams.get("state");
      const code = incoming.searchParams.get("code");

      if (error) {
        res.statusCode = 400;
        res.end("Atlassian OAuth failed. You can close this tab.");
        finish(new Error(description ? `${error}: ${description}` : error));
        return;
      }
      if (state !== expectedState) {
        res.statusCode = 400;
        res.end("Invalid state. You can close this tab.");
        finish(new Error("Atlassian OAuth state mismatch."));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end("Missing code. You can close this tab.");
        finish(new Error("Atlassian OAuth callback did not include a code."));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        "<html><body><h1>Forgeflow connected to Atlassian.</h1><p>You can close this tab and return to Pi.</p></body></html>",
      );
      finish(undefined, code);
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    server.listen(port, hostname);
  });
}

export async function loginWithAtlassianOauth(
  callbacks: LoginCallbacks = {},
  deps?: AtlassianOauthDeps,
): Promise<{ resources: AtlassianAccessibleResource[] } | string> {
  const config = getAtlassianOauthConfig();
  if (typeof config === "string") return config;

  callbacks.onStatus?.("Waiting for Atlassian login...");
  const state = (deps?.randomBytesFn ?? randomBytes)(16).toString("hex");
  const authUrl = buildAtlassianAuthUrl(config, state);
  callbacks.onAuthUrl?.(authUrl);
  callbacks.onStatus?.("Copy the Atlassian URL shown in the widget or terminal into your browser.");

  let code: string;
  try {
    code = await waitForOauthCallback(config.redirectUri, state);
  } catch (err) {
    return `Atlassian OAuth login failed: ${(err as Error).message}`;
  }

  callbacks.onStatus?.("Exchanging Atlassian authorisation code...");
  const token = await exchangeCode(code, config, deps);
  if (typeof token === "string") return token;

  await writeAtlassianOauthToken(token);
  const resources = await fetchAtlassianAccessibleResources(token.accessToken, deps);
  if (typeof resources === "string") return resources;

  callbacks.onStatus?.("Atlassian login complete.");
  return { resources };
}
