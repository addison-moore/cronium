import { z } from "zod";
import { protectedProcedure, createTRPCRouter } from "../../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import {
  credentialEncryption,
  type EncryptedData,
} from "@/lib/security/credential-encryption";

// Google Sheets-specific schemas
const googleSheetsTestSchema = z.object({
  toolId: z.number().int().positive(),
});

// Helper to get and decrypt tool credentials
async function getGoogleSheetsTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "GOOGLE_SHEETS"),
    ),
  });

  if (!tool) {
    return null;
  }

  // Decrypt credentials
  let parsedCredentials: Record<string, unknown> = {};
  if (tool.encrypted && tool.credentials) {
    try {
      const encryptedData = JSON.parse(tool.credentials) as EncryptedData;
      const decrypted = await credentialEncryption.decrypt(encryptedData);
      parsedCredentials =
        typeof decrypted === "string"
          ? (JSON.parse(decrypted) as Record<string, unknown>)
          : (decrypted as Record<string, unknown>);
    } catch (error) {
      console.error("Failed to decrypt Google Sheets credentials:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to decrypt credentials",
      });
    }
  } else if (tool.credentials) {
    try {
      parsedCredentials =
        typeof tool.credentials === "string"
          ? (JSON.parse(tool.credentials) as Record<string, unknown>)
          : (tool.credentials as Record<string, unknown>);
    } catch {
      parsedCredentials = {};
    }
  }

  return {
    ...tool,
    credentials: parsedCredentials,
  };
}

export const googleSheetsRouter = createTRPCRouter({
  testConnection: protectedProcedure
    .input(googleSheetsTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getGoogleSheetsTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Google Sheets tool not found",
        });
      }

      // Real token check; the OAuth credential bridge injects
      // credentials.oauthToken when the user's Google account is connected
      const { injectOAuthToken } =
        await import("@/lib/oauth/credential-bridge");
      const credentials = await injectOAuthToken(tool.credentials, {
        userId: ctx.session.user.id,
        toolId: tool.id,
        toolType: tool.type,
      });

      const { testToolConnection } = await import("./connection-tests");
      const result = await testToolConnection("google-sheets", credentials);
      return {
        success: result.success,
        message: result.message,
        details: result.details,
      };
    }),
});
