import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";
import { nanoid } from "nanoid";
import { TokenStatus } from "@/shared/schema";
import { API_TOKEN_SCOPES } from "@/server/token-scopes";

// Maximum token lifetime (security plan Phase 1.5). Tokens cannot be issued
// without an expiry, and never longer than this.
const MAX_TOKEN_EXPIRY_DAYS = 90;

// Schemas
const createApiTokenSchema = z.object({
  name: z.string().min(1, "Token name is required").max(100),
  // Explicit least-privilege scopes are REQUIRED — there is no implicit
  // full-access default. Use the "full" scope for a broad token deliberately.
  scopes: z
    .array(z.enum(API_TOKEN_SCOPES))
    .min(1, "At least one scope is required"),
  // Required expiry, capped at 90 days.
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOKEN_EXPIRY_DAYS)
    .default(MAX_TOKEN_EXPIRY_DAYS),
});

const tokenIdSchema = z.object({
  id: z.number().int().positive(),
});

// Helper function to verify token ownership
async function verifyTokenOwnership(tokenId: number, userId: string) {
  const token = await storage.getApiToken(tokenId);

  if (!token) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Token not found",
    });
  }

  if (token.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to access this token",
    });
  }

  return token;
}

export const authRouter = createTRPCRouter({
  // Get all API tokens for the current user
  getApiTokens: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.session.user.id;
      const tokens = await storage.getUserApiTokens(userId);

      // Remove the actual token from the response for security
      const sanitizedTokens = tokens.map((token) => {
        const { token: _, ...rest } = token;
        return rest;
      });

      return sanitizedTokens;
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch API tokens",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Create a new API token
  createApiToken: protectedProcedure
    .input(createApiTokenSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;

        // Generate a secure token
        const token = nanoid(32);

        const expiresAt = new Date(
          Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
        );

        // Store the token in the database
        const apiToken = await storage.createApiToken({
          userId,
          name: input.name,
          token,
          status: TokenStatus.ACTIVE,
          scopes: input.scopes,
          expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Return the token once (it won't be retrievable after this)
        return {
          ...apiToken,
          displayToken: token, // Only returned once
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create API token",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Revoke an API token (set status to REVOKED)
  revokeApiToken: protectedProcedure
    .input(tokenIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;

        // Verify token belongs to the user
        await verifyTokenOwnership(input.id, userId);

        // Revoke the token
        const updatedToken = await storage.revokeApiToken(input.id);

        // Remove the actual token from the response for security

        const { token: _token, ...sanitizedToken } = updatedToken;

        return sanitizedToken;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to revoke API token",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Delete an API token permanently
  deleteApiToken: protectedProcedure
    .input(tokenIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;

        // Verify token belongs to the user
        await verifyTokenOwnership(input.id, userId);

        // Delete the token
        await storage.deleteApiToken(input.id);

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete API token",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),
});
