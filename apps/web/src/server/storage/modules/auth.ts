import { db } from "../../db";
import {
  apiTokens,
  passwordResetTokens,
  TokenStatus,
} from "../../../shared/schema";
import type {
  ApiToken,
  InsertApiToken,
  PasswordResetToken,
  InsertPasswordResetToken,
} from "../../../shared/schema";
import { eq, and, desc, gte, lt } from "drizzle-orm";
import { encryptionService } from "../../../lib/encryption-service";

export class AuthStorage {
  // API Token methods
  async getApiToken(id: number): Promise<ApiToken | undefined> {
    const [token] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, id));
    if (token?.token && typeof token.token === "string") {
      try {
        token.token = encryptionService.decrypt(token.token);
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
      }
    }
    return token;
  }

  async getApiTokenByToken(token: string): Promise<ApiToken | undefined> {
    const allTokens = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.status, TokenStatus.ACTIVE));

    for (const apiToken of allTokens) {
      try {
        if (typeof apiToken.token === "string") {
          const decryptedToken = encryptionService.decrypt(apiToken.token);
          if (decryptedToken === token) {
            return { ...apiToken, token: decryptedToken };
          }
        }
      } catch (error) {
        // Log the error but continue processing other tokens
        console.error(
          `Failed to decrypt API token (ID: ${apiToken.id}):`,
          error instanceof Error ? error.message : "Unknown error",
        );
        continue;
      }
    }

    return undefined;
  }

  async getUserApiTokens(userId: string): Promise<ApiToken[]> {
    const tokens = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));

    return tokens.map((token) => {
      try {
        if (typeof token.token === "string") {
          return { ...token, token: encryptionService.decrypt(token.token) };
        }
        return token;
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
        return token;
      }
    });
  }

  async createApiToken(insertToken: InsertApiToken): Promise<ApiToken> {
    const encryptedToken = {
      ...insertToken,
      token: encryptionService.encrypt(insertToken.token),
    };

    const [token] = await db
      .insert(apiTokens)
      .values(encryptedToken)
      .returning();

    if (!token) {
      throw new Error("Failed to create API token");
    }
    return { ...token, token: insertToken.token };
  }

  async updateApiToken(
    id: number,
    updateData: Partial<InsertApiToken>,
  ): Promise<ApiToken> {
    const updateDataWithEncryption = { ...updateData };

    if (updateData.token) {
      updateDataWithEncryption.token = encryptionService.encrypt(
        updateData.token,
      );
    }

    const [token] = await db
      .update(apiTokens)
      .set({ ...updateDataWithEncryption, updatedAt: new Date() })
      .where(eq(apiTokens.id, id))
      .returning();

    if (!token) {
      throw new Error("Failed to update API token - token not found");
    }
    if (token.token && typeof token.token === "string") {
      try {
        token.token = encryptionService.decrypt(token.token);
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
      }
    }

    return token;
  }

  async deleteApiToken(id: number): Promise<void> {
    await db.delete(apiTokens).where(eq(apiTokens.id, id));
  }

  async revokeApiToken(id: number): Promise<ApiToken> {
    const [token] = await db
      .update(apiTokens)
      .set({
        status: TokenStatus.REVOKED,
        updatedAt: new Date(),
      })
      .where(eq(apiTokens.id, id))
      .returning();

    if (!token) {
      throw new Error("Failed to revoke API token - token not found");
    }
    if (token.token && typeof token.token === "string") {
      try {
        token.token = encryptionService.decrypt(token.token);
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
      }
    }

    return token;
  }

  // Password Reset Token methods
  async createPasswordResetToken(
    insertToken: InsertPasswordResetToken,
  ): Promise<PasswordResetToken> {
    const [token] = await db
      .insert(passwordResetTokens)
      .values(insertToken)
      .returning();

    if (!token) {
      throw new Error("Failed to create password reset token");
    }
    return token;
  }

  async getPasswordResetToken(
    token: string,
  ): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          eq(passwordResetTokens.used, false),
          gte(passwordResetTokens.expiresAt, new Date()),
        ),
      );

    return resetToken;
  }

  async markPasswordResetTokenAsUsed(token: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.token, token));
  }

  async deleteExpiredPasswordResetTokens(): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()));
  }
}
