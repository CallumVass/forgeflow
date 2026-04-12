import { getMcpAuthStatus, loginWithMcpOauth } from "./auth/login.js";
import { clearMcpOauthState, getMcpOauthStatePath, readMcpOauthState, writeMcpOauthState } from "./auth/state.js";
import { withMcpSession } from "./session/index.js";
import { callMcpTool, parseMcpJson, resolveMcpTool } from "./tools/index.js";
import type {
  LoginCallbacks,
  McpAuthState,
  McpAuthStatus,
  McpConfig,
  McpLoginResult,
  McpOauthDeps,
  McpSession,
} from "./types.js";

export interface McpService {
  getOauthStatePath(): string;
  readOauthState(): Promise<McpAuthState | null>;
  writeOauthState(state: McpAuthState): Promise<void>;
  clearOauthState(): Promise<void>;
  login(callbacks?: LoginCallbacks, deps?: McpOauthDeps): Promise<McpLoginResult | string>;
  getAuthStatus(): Promise<McpAuthStatus | string>;
  withSession<T>(fn: (session: McpSession) => Promise<T>): Promise<T | string>;
  callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<unknown | string>;
  parseJson(result: unknown): unknown | string;
  resolveTool(
    session: Pick<McpSession, "tools" | "toolNames">,
    aliases: string[],
    requiredTerms: string[],
    optionalTerms: string[],
    options?: { requireOptionalMatch?: boolean },
  ): string | undefined;
}

interface CreateMcpServiceOptions {
  integration: string;
  serviceLabel: string;
  loginCommand: string;
  loginClientName: string;
  sessionClientName: string;
  getConfig: () => McpConfig | string;
}

export function createMcpService(options: CreateMcpServiceOptions): McpService {
  const statePath = () => getMcpOauthStatePath(options.integration);

  return {
    getOauthStatePath: () => statePath(),
    readOauthState: () => readMcpOauthState(statePath()),
    writeOauthState: (state) => writeMcpOauthState(statePath(), state),
    clearOauthState: () => clearMcpOauthState(statePath()),
    async login(callbacks = {}, deps) {
      const config = options.getConfig();
      if (typeof config === "string") return config;

      return loginWithMcpOauth(
        config,
        {
          statePath: statePath(),
          serviceLabel: options.serviceLabel,
          loginClientName: options.loginClientName,
        },
        callbacks,
        deps,
      );
    },
    async getAuthStatus() {
      const config = options.getConfig();
      if (typeof config === "string") return config;
      return getMcpAuthStatus(config, statePath());
    },
    async withSession(fn) {
      const config = options.getConfig();
      if (typeof config === "string") return config;
      return withMcpSession(
        config,
        statePath(),
        {
          serviceLabel: options.serviceLabel,
          loginCommand: options.loginCommand,
          sessionClientName: options.sessionClientName,
        },
        fn,
      );
    },
    callTool(session, name, args) {
      return callMcpTool(session, name, args, options.serviceLabel);
    },
    parseJson(result) {
      return parseMcpJson(result, options.serviceLabel);
    },
    resolveTool(session, aliases, requiredTerms, optionalTerms, resolveOptions) {
      return resolveMcpTool(session, aliases, requiredTerms, optionalTerms, resolveOptions);
    },
  };
}
