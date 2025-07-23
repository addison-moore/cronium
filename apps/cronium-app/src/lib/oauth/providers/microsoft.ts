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

  getAuthorizationUrl(state: string, scope?: string): string {
    const params: Record<string, string> = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      state,
      scope: scope ?? this.config.scope,
      response_mode: "query",
    };

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

// Helper function to create Microsoft provider for common services
export function createMicrosoftProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  service: "teams" | "outlook" | "onedrive" | "graph" | "all",
  tenantId?: string,
): MicrosoftOAuthProvider {
  const scopes: Record<string, string> = {
    teams:
      "offline_access Team.ReadWrite.All Channel.ReadWrite.All Chat.ReadWrite",
    outlook: "offline_access Mail.Send Calendars.ReadWrite",
    onedrive: "offline_access Files.ReadWrite.All",
    graph: "offline_access User.Read",
    all: "offline_access User.Read Team.ReadWrite.All Mail.Send Calendars.ReadWrite Files.ReadWrite.All",
  };

  return new MicrosoftOAuthProvider({
    clientId,
    clientSecret,
    redirectUri,
    scope: scopes[service]!,
    ...(tenantId && { tenantId }),
  });
}
