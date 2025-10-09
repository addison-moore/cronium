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

// Notion-specific schemas
const notionTestSchema = z.object({
  toolId: z.number().int().positive(),
});

// Helper to get and decrypt tool credentials
async function getNotionTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "NOTION"),
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
      console.error("Failed to decrypt Notion credentials:", error);
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

export const notionRouter = createTRPCRouter({
  testConnection: protectedProcedure
    .input(notionTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getNotionTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notion tool not found",
        });
      }

      const apiKey = tool.credentials.apiKey as string;
      if (!apiKey) {
        return {
          success: false,
          message: "API key not found in credentials",
        };
      }

      try {
        // Test by fetching user info
        const response = await fetch("https://api.notion.com/v1/users/me", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Notion-Version": "2022-06-28",
          },
        });

        if (!response.ok) {
          return {
            success: false,
            message: `Notion API error: ${response.status}`,
          };
        }

        const data = (await response.json()) as { name?: string };

        return {
          success: true,
          message: "Notion connection test successful",
          details: {
            workspace: data.name ?? "Unknown",
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
