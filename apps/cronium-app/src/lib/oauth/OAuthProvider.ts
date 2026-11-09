import {
  type OAuthProvider,
  type OAuthProviderConfig,
  type OAuthToken,
  OAuthError,
  type OAuthTokenResponse,
} from "./types";
import { failureWithStack } from "@/lib/pg-errors";

/**
 * Why a token endpoint refused. The reason ends up in a redirect's URL and the log, so
 * only RFC 6749's two fields are taken from the answer: the rest of it could be a
 * gateway's whole error page.
 */
function readTokenError(
  status: number,
  body: string,
): { code?: string; reason: string } {
  try {
    const { error, error_description: description } = JSON.parse(
      body,
    ) as Record<string, unknown>;
    if (typeof error === "string") {
      return {
        code: error,
        reason:
          typeof description === "string" ? `${description} (${error})` : error,
      };
    }
  } catch {
    // Not JSON, so nothing in it was written for a caller.
  }
  return { reason: `the provider answered ${status}` };
}

export abstract class BaseOAuthProvider implements OAuthProvider {
  constructor(protected config: OAuthProviderConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  abstract getAuthorizationUrl(
    state: string,
    scope?: string,
    codeChallenge?: string,
  ): string;

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
        const { reason } = readTokenError(
          response.status,
          await response.text(),
        );
        throw new OAuthError(
          `Token exchange failed: ${reason}`,
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
        const { code, reason } = readTokenError(
          response.status,
          await response.text(),
        );
        throw new OAuthError(
          `Token refresh failed: ${reason}`,
          code ?? "token_refresh_failed",
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
      console.error("Failed to revoke token:", failureWithStack(error));
    }
  }

  protected parseTokenResponse(response: OAuthTokenResponse): OAuthToken {
    // The type is only a cast of whatever came back, and a provider can answer 200 with
    // an error in the body.
    if (typeof response.access_token !== "string" || !response.access_token) {
      throw new OAuthError(
        "The provider's answer had no access token",
        "invalid_token_response",
      );
    }

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
