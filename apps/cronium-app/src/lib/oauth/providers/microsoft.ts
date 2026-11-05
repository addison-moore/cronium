import { BaseOAuthProvider } from "../OAuthProvider";
import { type OAuthProviderConfig } from "../types";

export class MicrosoftOAuthProvider extends BaseOAuthProvider {
  constructor(
    config: Omit<
      OAuthProviderConfig,
      "id" | "name" | "authorizationUrl" | "tokenUrl"
    > & {
      tenantId?: string;
    },
  ) {
    const tenantId = config.tenantId ?? "common";
    super({
      ...config,
      id: "microsoft",
      name: "Microsoft",
      authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    });
  }

  getAuthorizationUrl(
    state: string,
    scope?: string,
    codeChallenge?: string,
  ): string {
    const params: Record<string, string> = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      state,
      scope: scope ?? this.config.scope,
      response_mode: "query",
    };

    if (codeChallenge) {
      params.code_challenge = codeChallenge;
      params.code_challenge_method = "S256";
    }

    // Add any provider-specific options
    if (this.config.options?.prompt) {
      params.prompt = this.config.options.prompt as string;
    }

    return this.buildAuthUrl(this.config.authorizationUrl, params);
  }

  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!this.config.userInfoUrl) {
      throw new Error("User info URL not configured");
    }

    const response = await fetch(this.config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
