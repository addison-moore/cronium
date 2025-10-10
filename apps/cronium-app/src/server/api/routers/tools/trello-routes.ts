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

// Trello-specific schemas
const trelloTestSchema = z.object({
  toolId: z.number().int().positive(),
});

// Helper to get and decrypt tool credentials
async function getTrelloTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "TRELLO"),
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
      console.error("Failed to decrypt Trello credentials:", error);
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

export const trelloRouter = createTRPCRouter({
  testConnection: protectedProcedure
    .input(trelloTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getTrelloTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Trello tool not found",
        });
      }

      const apiKey = tool.credentials.apiKey as string;
      const apiToken = tool.credentials.apiToken as string;

      if (!apiKey || !apiToken) {
        return {
          success: false,
          message: "API key or token not found in credentials",
        };
      }

      try {
        // Test by fetching member info
        const response = await fetch(
          `https://api.trello.com/1/members/me?key=${apiKey}&token=${apiToken}`,
          {
            method: "GET",
          },
        );

        if (!response.ok) {
          return {
            success: false,
            message: `Trello API error: ${response.status}`,
          };
        }

        const data = (await response.json()) as {
          fullName?: string;
          username?: string;
        };

        return {
          success: true,
          message: "Trello connection test successful",
          details: {
            user: data.fullName ?? data.username ?? "Unknown",
          },
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    }),
});
