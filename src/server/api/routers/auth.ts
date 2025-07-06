import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";
import { nanoid } from "nanoid";
import { TokenStatus } from "@/shared/schema";

// Schemas
const createApiTokenSchema = z.object({
  name: z.string().min(1, "Token name is required").max(100),
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

        // Store the token in the database
        const apiToken = await storage.createApiToken({
          userId,
          name: input.name,
          token,
          status: TokenStatus.ACTIVE,
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
