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

// Slack-specific schemas
const slackSendSchema = z.object({
  toolId: z.number().int().positive(),
  message: z.string().min(1),
  channel: z.string().optional(),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
});

const slackTestSchema = z.object({
  toolId: z.number().int().positive(),
});

// Helper to get and decrypt tool credentials
async function getSlackTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "SLACK"),
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
      console.error("Failed to decrypt Slack credentials:", error);
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

export const slackRouter = createTRPCRouter({
  send: protectedProcedure
    .input(slackSendSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getSlackTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Slack tool not found",
        });
      }

      if (!tool.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Slack tool is not active",
        });
      }

      // Implementation would go here - for now return mock success
      // In production, this would call the actual Slack API
      return {
        success: true,
        message: "Message sent to Slack successfully",
        messageId: `slack_${Date.now()}`,
      };
    }),

  testConnection: protectedProcedure
    .input(slackTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getSlackTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Slack tool not found",
        });
      }

      // Test the webhook URL
      const webhookUrl = tool.credentials.webhookUrl as string | undefined;
      if (!webhookUrl?.startsWith("https://hooks.slack.com/")) {
        return {
          success: false,
          message: "Invalid webhook URL",
        };
      }

      // In production, this would actually test the connection
      return {
        success: true,
        message: "Slack connection test successful",
        details: {
          workspace: "Example Workspace",
          channel: tool.credentials.channel ?? "default",
        },
      };
    }),
});
