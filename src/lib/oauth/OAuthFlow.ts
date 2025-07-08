import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { oauthStates } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { type OAuthProvider } from "./providers";
import { TokenManager } from "./TokenManager";
import {
  OAuthAuthRequest,
  type OAuthCallbackParams,
  OAuthError,
} from "./types";

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
  ): Promise<string> {
    // Generate state for CSRF protection
    const state = randomBytes(32).toString("hex");

    // Generate PKCE code verifier (for providers that support it)
    const codeVerifier = randomBytes(32).toString("base64url");

    // Store state in database
    await db.insert(oauthStates).values({
      state,
      userId,
      toolId,
      providerId: this.provider.id,
      redirectUri,
      codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    // Get authorization URL
    const authUrl = this.provider.getAuthorizationUrl(state, scope);

    return authUrl;
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(params: OAuthCallbackParams): Promise<{
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

    // Validate state
    const stateRecord = await db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, params.state))
      .limit(1);

    if (stateRecord.length === 0) {
      throw new OAuthError("Invalid state parameter", "invalid_state", 400);
    }

    const authRequest = stateRecord[0];

    // Check if state is expired
    if (authRequest.expiresAt < new Date()) {
      await db.delete(oauthStates).where(eq(oauthStates.state, params.state));
      throw new OAuthError("State has expired", "state_expired", 400);
    }

    // Exchange code for tokens
    try {
      const tokens = await this.provider.exchangeCodeForTokens(
        params.code,
        authRequest.codeVerifier ?? undefined,
      );

      // Store tokens
      await this.tokenManager.storeTokens(
        authRequest.userId,
        authRequest.toolId,
        tokens,
      );

      // Clean up state
      await db.delete(oauthStates).where(eq(oauthStates.state, params.state));

      return {
        userId: authRequest.userId,
        toolId: authRequest.toolId,
      };
    } catch (error) {
      // Clean up state on error
      await db.delete(oauthStates).where(eq(oauthStates.state, params.state));

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
    await db.delete(oauthStates).where(eq(oauthStates.expiresAt, new Date()));
  }
}
