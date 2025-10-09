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
import { discordSendSchema } from "@/tools/plugins/discord/schemas";

// Discord-specific schemas
const discordTestSchema = z.object({
  toolId: z.number().int().positive(),
});

// Helper to get and decrypt tool credentials
async function getDiscordTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "DISCORD"),
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
      console.error("Failed to decrypt Discord credentials:", error);
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

export const discordRouter = createTRPCRouter({
  send: protectedProcedure
    .input(discordSendSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getDiscordTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Discord tool not found",
        });
      }

      if (!tool.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Discord tool is not active",
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
        // Build the payload
        const payload: Record<string, unknown> = {
          content: input.message,
        };

        // Add optional fields
        if (input.username || tool.credentials.username) {
          payload.username = input.username ?? tool.credentials.username;
        }
        if (input.avatarUrl || tool.credentials.avatarUrl) {
          payload.avatar_url = input.avatarUrl ?? tool.credentials.avatarUrl;
        }
        if (input.tts) {
          payload.tts = input.tts;
        }
        if (input.embeds) {
          payload.embeds = input.embeds;
        }
        if (input.components) {
          payload.components = input.components;
        }

        // Send the request to Discord
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
            message: `Discord API error: ${response.status} ${errorText}`,
          });
        }

        return {
          success: true,
          message: "Message sent to Discord successfully",
          messageId: `discord_${Date.now()}`,
          timestamp: new Date().toISOString(),
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
    .input(discordTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getDiscordTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Discord tool not found",
        });
      }

      const webhookUrl = tool.credentials.webhookUrl as string | undefined;
      if (!webhookUrl?.includes("discord.com/api/webhooks")) {
        return {
          success: false,
          message: "Invalid Discord webhook URL",
        };
      }

      try {
        // Parse webhook URL to extract webhook ID
        const urlMatch = /webhooks\/(\d+)\//.exec(webhookUrl);
        const webhookId = urlMatch ? urlMatch[1] : undefined;

        // Test with a minimal payload
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: "🔗 Cronium connection test",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            success: false,
            message: `Discord API error: ${response.status} ${errorText}`,
          };
        }

        return {
          success: true,
          message: "Discord connection test successful",
          details: {
            webhookId,
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
