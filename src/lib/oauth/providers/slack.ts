import { BaseOAuthProvider } from "../OAuthProvider";
import {
  type OAuthProviderConfig,
  type OAuthToken,
  type OAuthTokenResponse,
} from "../types";

export class SlackOAuthProvider extends BaseOAuthProvider {
  constructor(
    config: Omit<
      OAuthProviderConfig,
      "id" | "name" | "authorizationUrl" | "tokenUrl"
    >,
  ) {
    super({
      ...config,
      id: "slack",
      name: "Slack",
      authorizationUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      revokeUrl: "https://slack.com/api/auth.revoke",
      userInfoUrl: "https://slack.com/api/users.identity",
    });
  }

  getAuthorizationUrl(state: string, scope?: string): string {
    const params: Record<string, string> = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      scope: scope ?? this.config.scope,
    };

    // Add user_scope for user tokens if needed
    if (this.config.options?.userScope) {
      params.user_scope = this.config.options.userScope as string;
    }

    // Add team if restricting to specific workspace
    if (this.config.options?.team) {
      params.team = this.config.options.team as string;
    }

    return this.buildAuthUrl(this.config.authorizationUrl, params);
  }

  protected parseTokenResponse(
    response: OAuthTokenResponse & {
      ok?: boolean;
      error?: string;
      team?: { id: string; name: string };
      authed_user?: { id: string; scope: string; access_token: string };
    },
  ): OAuthToken {
    if (!response.ok) {
      throw new Error(`Slack OAuth error: ${response.error}`);
    }

    // Slack returns tokens differently
    return {
      accessToken: response.access_token,
      tokenType: "Bearer",
      scope: response.scope,
      // Slack tokens don't expire, but we can store additional info
    };
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

    const data = (await response.json()) as Record<string, unknown>;

    if (!(data.ok as boolean)) {
      throw new Error(`Slack API error: ${data.error as string}`);
    }

    return data;
  }
}

// Helper function to create Slack provider with common scopes
export function createSlackProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  botScopes: string[] = [],
  userScopes: string[] = [],
): SlackOAuthProvider {
  const defaultBotScopes = [
    "channels:read",
    "channels:write",
    "chat:write",
    "files:write",
    "users:read",
  ];

  const defaultUserScopes = ["identity.basic", "identity.email"];

  const provider = new SlackOAuthProvider({
    clientId,
    clientSecret,
    redirectUri,
    scope: [...new Set([...defaultBotScopes, ...botScopes])].join(","),
    options: {
      userScope: [...new Set([...defaultUserScopes, ...userScopes])].join(","),
    },
  });

  return provider;
}
