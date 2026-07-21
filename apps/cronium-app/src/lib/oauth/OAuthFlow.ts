import { createHash, randomBytes } from "crypto";
import { db } from "@/server/db";
import { oauthStates } from "@/shared/schema";
import { and, eq, gte } from "drizzle-orm";
import { type OAuthProvider } from "./providers";
import { TokenManager } from "./TokenManager";
import { type OAuthCallbackParams, OAuthError } from "./types";

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Result of starting a flow: the provider URL plus the browser-binding nonce. */
export interface OAuthInitiation {
  authUrl: string;
  browserNonce: string;
}

export class OAuthFlow {
  private tokenManager: TokenManager;

  constructor(private provider: OAuthProvider) {
    this.tokenManager = new TokenManager(provider);
  }

  /**
   * Initialize OAuth flow
   */
  async initiate(
    userId: string,
    toolId: number,
    redirectUri: string,
    scope?: string,
  ): Promise<OAuthInitiation> {
    // Generate state for CSRF protection
    const state = randomBytes(32).toString("hex");

    // PKCE: the verifier is stored server-side; the S256 challenge is sent to
    // the provider so an intercepted authorization code cannot be exchanged
    // without the verifier.
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = sha256Base64Url(codeVerifier);

    // Browser-binding nonce: the plaintext goes to the initiating browser as an
    // HttpOnly cookie; only its hash is stored. The callback must present the
    // matching nonce, so an attacker's authorization URL cannot complete in a
    // victim's browser (HI-06).
    const browserNonce = randomBytes(32).toString("base64url");

    await db.insert(oauthStates).values({
      state,
      userId,
      toolId,
      providerId: this.provider.id,
      redirectUri,
      codeVerifier,
      browserNonceHash: sha256Hex(browserNonce),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    const authUrl = this.provider.getAuthorizationUrl(
      state,
      scope,
      codeChallenge,
    );

    return { authUrl, browserNonce };
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(
    params: OAuthCallbackParams,
    browserNonce?: string,
  ): Promise<{
    userId: string;
    toolId: number;
  }> {
    // Check for errors
    if (params.error) {
      throw new OAuthError(
        params.errorDescription ?? params.error,
        params.error,
        400,
      );
    }

    // Atomically claim the state: delete-and-return only if unexpired, so a
    // replayed callback can't reuse it and two concurrent callbacks can't both
    // proceed.
    const [authRequest] = await db
      .delete(oauthStates)
      .where(
        and(
          eq(oauthStates.state, params.state),
          gte(oauthStates.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!authRequest) {
      throw new OAuthError(
        "Invalid or expired state parameter",
        "invalid_state",
        400,
      );
    }

    // Bind to the initiating browser: the callback must present the nonce whose
    // hash was stored at initiation (HI-06). A flow started without a nonce
    // (legacy row) is rejected rather than trusted.
    if (
      !authRequest.browserNonceHash ||
      !browserNonce ||
      sha256Hex(browserNonce) !== authRequest.browserNonceHash
    ) {
      throw new OAuthError(
        "OAuth session could not be verified for this browser",
        "invalid_browser_binding",
        400,
      );
    }

    // Exchange code for tokens
    try {
      const tokens = await this.provider.exchangeCodeForTokens(
        params.code,
        authRequest.codeVerifier ?? undefined,
      );

      // Store tokens (state was already consumed atomically above).
      await this.tokenManager.storeTokens(
        authRequest.userId,
        authRequest.toolId,
        tokens,
      );

      return {
        userId: authRequest.userId,
        toolId: authRequest.toolId,
      };
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }

      throw new OAuthError(
        `Token exchange failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "token_exchange_failed",
        400,
      );
    }
  }

  /**
   * Get token manager for this flow
   */
  getTokenManager(): TokenManager {
    return this.tokenManager;
  }

  /**
   * Clean up expired states
   */
  static async cleanupExpiredStates(): Promise<void> {
    const { lt } = await import("drizzle-orm");
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  }
}
