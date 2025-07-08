import { db } from "@/server/db";
import { oauthTokens } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { type OAuthToken, OAuthError } from "./types";
import type { OAuthProvider } from "./providers";

export class TokenManager {
  constructor(private provider: OAuthProvider) {}

  /**
   * Store OAuth tokens in the database
   */
  async storeTokens(
    userId: string,
    toolId: number,
    tokens: OAuthToken,
  ): Promise<void> {
    try {
      await db
        .insert(oauthTokens)
        .values({
          userId,
          toolId,
          providerId: this.provider.id,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          tokenType: tokens.tokenType,
          scope: tokens.scope,
        })
        .onConflictDoUpdate({
          target: [
            oauthTokens.userId,
            oauthTokens.toolId,
            oauthTokens.providerId,
          ],
          set: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      throw new OAuthError(
        `Failed to store tokens: ${error instanceof Error ? error.message : "Unknown error"}`,
        "storage_failed",
      );
    }
  }

  /**
   * Retrieve OAuth tokens from the database
   */
  async getTokens(userId: string, toolId: number): Promise<OAuthToken | null> {
    try {
      const result = await db
        .select()
        .from(oauthTokens)
        .where(
          and(
            eq(oauthTokens.userId, userId),
            eq(oauthTokens.toolId, toolId),
            eq(oauthTokens.providerId, this.provider.id),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken ?? undefined,
        expiresAt: row.expiresAt ?? undefined,
        tokenType: row.tokenType,
        scope: row.scope ?? undefined,
      };
    } catch (error) {
      throw new OAuthError(
        `Failed to retrieve tokens: ${error instanceof Error ? error.message : "Unknown error"}`,
        "retrieval_failed",
      );
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(userId: string, toolId: number): Promise<string> {
    const tokens = await this.getTokens(userId, toolId);

    if (!tokens) {
      throw new OAuthError("No tokens found for user", "tokens_not_found", 401);
    }

    // Check if token is expired
    if (tokens.expiresAt && tokens.expiresAt < new Date()) {
      if (!tokens.refreshToken) {
        throw new OAuthError(
          "Access token expired and no refresh token available",
          "token_expired",
          401,
        );
      }

      // Refresh the token
      try {
        const newTokens = await this.provider.refreshAccessToken(
          tokens.refreshToken,
        );
        await this.storeTokens(userId, toolId, newTokens);
        return newTokens.accessToken;
      } catch (error) {
        // If refresh fails, delete the invalid tokens
        await this.deleteTokens(userId, toolId);
        throw new OAuthError(
          "Failed to refresh access token",
          "refresh_failed",
          401,
        );
      }
    }

    return tokens.accessToken;
  }

  /**
   * Delete OAuth tokens from the database
   */
  async deleteTokens(userId: string, toolId: number): Promise<void> {
    try {
      const tokens = await this.getTokens(userId, toolId);

      if (tokens) {
        // Try to revoke tokens with provider
        try {
          await this.provider.revokeTokens(tokens.accessToken);
        } catch (error) {
          // Log but don't throw - we still want to delete from DB
          console.error("Failed to revoke tokens with provider:", error);
        }
      }

      await db
        .delete(oauthTokens)
        .where(
          and(
            eq(oauthTokens.userId, userId),
            eq(oauthTokens.toolId, toolId),
            eq(oauthTokens.providerId, this.provider.id),
          ),
        );
    } catch (error) {
      throw new OAuthError(
        `Failed to delete tokens: ${error instanceof Error ? error.message : "Unknown error"}`,
        "deletion_failed",
      );
    }
  }

  /**
   * Check if user has valid tokens
   */
  async hasValidTokens(userId: string, toolId: number): Promise<boolean> {
    try {
      const tokens = await this.getTokens(userId, toolId);
      if (!tokens) {
        return false;
      }

      // If no expiry, assume valid
      if (!tokens.expiresAt) {
        return true;
      }

      // Check if expired
      if (tokens.expiresAt < new Date()) {
        // If we have a refresh token, we can get new tokens
        return !!tokens.refreshToken;
      }

      return true;
    } catch {
      return false;
    }
  }
}
