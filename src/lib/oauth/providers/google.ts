import { BaseOAuthProvider } from "../OAuthProvider";
import { type OAuthProviderConfig, OAuthToken } from "../types";

export class GoogleOAuthProvider extends BaseOAuthProvider {
  constructor(
    config: Omit<
      OAuthProviderConfig,
      "id" | "name" | "authorizationUrl" | "tokenUrl"
    >,
  ) {
    super({
      ...config,
      id: "google",
      name: "Google",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    });
  }

  getAuthorizationUrl(state: string, scope?: string): string {
    const params: Record<string, string> = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      state,
      scope: scope ?? this.config.scope,
      access_type: "offline", // Request refresh token
      prompt: "consent", // Force consent to get refresh token
    };

    // Add any provider-specific options
    if (this.config.options?.hd) {
      params.hd = this.config.options.hd as string; // Google Workspace domain
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

// Helper function to create Google provider for common services
export function createGoogleProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  service: "drive" | "sheets" | "calendar" | "gmail" | "all",
): GoogleOAuthProvider {
  const scopes: Record<string, string> = {
    drive: "https://www.googleapis.com/auth/drive.file",
    sheets: "https://www.googleapis.com/auth/spreadsheets",
    calendar: "https://www.googleapis.com/auth/calendar",
    gmail: "https://www.googleapis.com/auth/gmail.send",
    all: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar",
  };

  return new GoogleOAuthProvider({
    clientId,
    clientSecret,
    redirectUri,
    scope: scopes[service] ?? scopes.all,
  });
}
