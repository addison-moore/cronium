import {
  type OAuthProvider,
  type OAuthProviderConfig,
  type OAuthToken,
  OAuthError,
  type OAuthTokenResponse,
} from "./types";

export abstract class BaseOAuthProvider implements OAuthProvider {
  constructor(protected config: OAuthProviderConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  abstract getAuthorizationUrl(state: string, scope?: string): string;

  async exchangeCodeForTokens(
    code: string,
    codeVerifier?: string,
  ): Promise<OAuthToken> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    });

    if (codeVerifier) {
      params.append("code_verifier", codeVerifier);
    }

    try {
      const response = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthError(
          `Token exchange failed: ${error}`,
          "token_exchange_failed",
          response.status,
        );
      }

      const data = (await response.json()) as OAuthTokenResponse;

      return this.parseTokenResponse(data);
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      throw new OAuthError(
        `Failed to exchange code: ${error instanceof Error ? error.message : "Unknown error"}`,
        "exchange_failed",
      );
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthToken> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthError(
          `Token refresh failed: ${error}`,
          "token_refresh_failed",
          response.status,
        );
      }

      const data = (await response.json()) as OAuthTokenResponse;

      return this.parseTokenResponse(data);
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      throw new OAuthError(
        `Failed to refresh token: ${error instanceof Error ? error.message : "Unknown error"}`,
        "refresh_failed",
      );
    }
  }

  async revokeTokens(token: string): Promise<void> {
    if (!this.config.revokeUrl) {
      // Not all providers support token revocation
      return;
    }

    const params = new URLSearchParams({
      token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await fetch(this.config.revokeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthError(
          `Token revocation failed: ${error}`,
          "revoke_failed",
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      // Log but don't throw - revocation is best effort
      console.error("Failed to revoke token:", error);
    }
  }

  protected parseTokenResponse(response: OAuthTokenResponse): OAuthToken {
    const token: OAuthToken = {
      accessToken: response.access_token,
      tokenType: response.token_type ?? "Bearer",
    };

    if (response.refresh_token) {
      token.refreshToken = response.refresh_token;
    }

    if (response.expires_in) {
      token.expiresAt = new Date(Date.now() + response.expires_in * 1000);
    }

    if (response.scope) {
      token.scope = response.scope;
    }

    return token;
  }

  protected buildAuthUrl(
    baseUrl: string,
    params: Record<string, string>,
  ): string {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    return url.toString();
  }
}
