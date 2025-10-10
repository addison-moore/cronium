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

// Teams-specific schemas
const teamsTestSchema = z.object({
  toolId: z.number().int().positive(),
});

const teamsSendSchema = z.object({
  toolId: z.number().int().positive(),
  message: z.string().min(1),
  title: z.string().optional(),
});

// Helper to get and decrypt tool credentials
async function getTeamsTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "TEAMS"),
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
      console.error("Failed to decrypt Teams credentials:", error);
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

export const teamsRouter = createTRPCRouter({
  send: protectedProcedure
    .input(teamsSendSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getTeamsTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Teams tool not found",
        });
      }

      if (!tool.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Teams tool is not active",
        });
      }

      const webhookUrl = tool.credentials.webhookUrl as string;
      if (!webhookUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Webhook URL not found in credentials",
        });
      }

      try {
        // Build Teams message card
        const payload = {
          "@type": "MessageCard",
          "@context": "https://schema.org/extensions",
          summary: input.title ?? "Cronium Notification",
          themeColor: "0078D4",
          title: input.title,
          text: input.message,
        };

        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Teams API error: ${response.status} ${errorText}`,
          });
        }

        return {
          success: true,
          message: "Message sent to Teams successfully",
          messageId: `teams_${Date.now()}`,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to send message",
        });
      }
    }),

  testConnection: protectedProcedure
    .input(teamsTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getTeamsTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Teams tool not found",
        });
      }

      const webhookUrl = tool.credentials.webhookUrl as string;
      if (!webhookUrl) {
        return {
          success: false,
          message: "Webhook URL not found in credentials",
        };
      }

      try {
        // Test with a minimal payload
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            "@type": "MessageCard",
            "@context": "https://schema.org/extensions",
            text: "🔗 Cronium connection test",
          }),
        });

        if (!response.ok) {
          return {
            success: false,
            message: `Teams API error: ${response.status}`,
          };
        }

        return {
          success: true,
          message: "Teams connection test successful",
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    }),
});
