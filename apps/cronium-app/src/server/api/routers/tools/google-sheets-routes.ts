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

      // Validate required credentials
      if (!tool.credentials.clientId || !tool.credentials.clientSecret) {
        return {
          success: false,
          message: "Missing required credentials (clientId or clientSecret)",
        };
      }

      return {
        success: true,
        message: "Google Sheets credentials validated",
        details: {
          hasRefreshToken: !!tool.credentials.refreshToken,
          scope:
            tool.credentials.scope ??
            "https://www.googleapis.com/auth/spreadsheets",
        },
      };
    }),
});
