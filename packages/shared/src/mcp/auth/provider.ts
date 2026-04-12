import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpAuthState, McpConfig } from "../types.js";
import { writeMcpOauthState } from "./state.js";

export class StoredMcpOAuthProvider implements OAuthClientProvider {
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
