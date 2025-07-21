import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  withTiming,
  withRateLimit,
} from "../trpc";
import {
  bulkSendSchema,
  messageHistorySchema,
  messageStatsSchema,
  testMessageSchema,
} from "@shared/schemas/integrations";
import { z } from "zod";

// Temporary schemas - these will be removed when integrations router is deprecated
const baseSendMessageSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.number().int().positive().optional(),
  variables: z.record(z.string()).optional(),
});

const slackSendSchema = baseSendMessageSchema.extend({
  channel: z.string().optional(),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
  iconUrl: z.string().url().optional(),
  threadTs: z.string().optional(),
  unfurlLinks: z.boolean().default(true),
  unfurlMedia: z.boolean().default(true),
  blocks: z.array(z.any()).optional(),
  attachments: z.array(z.any()).optional(),
});

const discordSendSchema = baseSendMessageSchema.extend({
  username: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  tts: z.boolean().default(false),
  embeds: z.array(z.any()).optional(),
  components: z.array(z.any()).optional(),
});

const emailSendSchema = baseSendMessageSchema.extend({
  recipients: z.string().min(1, "Recipients are required"),
  subject: z.string().min(1, "Subject is required"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  replyTo: z.string().email().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  isHtml: z.boolean().default(false),
  attachments: z.array(z.any()).optional(),
  trackOpens: z.boolean().default(false),
  trackClicks: z.boolean().default(false),
});

import { withErrorHandling, notFoundError } from "@/server/utils/error-utils";
import {
  listResponse,
  mutationResponse,
  statsResponse,
} from "@/server/utils/api-patterns";
import {
  normalizePagination,
  createPaginatedResult,
} from "@/server/utils/db-patterns";
// ToolType import removed - using strings directly

// Use standardized procedure with timing and rate limiting
const integrationProcedure = protectedProcedure
  .use(withTiming)
  .use(withRateLimit(100, 60000)); // 100 integration requests per minute

// Helper function to get user tool (mock implementation)
async function getUserTool(
  userId: string,
  toolId: number,
): Promise<
  | {
      id: number;
      userId: string;
      name: string;
      type: string;
      credentials: Record<string, unknown>;
      isActive: boolean;
    }
  | undefined
> {
  // Mock tool data - in real implementation, this would query the database
  const mockTools = [
    {
      id: 1,
      userId,
      name: "Default Slack",
      type: "slack" as const,
      credentials: {
        webhookUrl:
          "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
        channel: "#general",
        username: "Cronium Bot",
      },
      isActive: true,
    },
    {
      id: 2,
      userId,
      name: "Email SMTP",
      type: "email" as const,
      credentials: {
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "cronium@example.com",
        smtpPassword: "password123",
        fromEmail: "cronium@example.com",
        fromName: "Cronium System",
        enableTLS: true,
      },
      isActive: true,
    },
  ];

  return mockTools.find((tool) => tool.id === toolId && tool.userId === userId);
}

/**
 * @deprecated This router is deprecated. Use the new plugin-based routes at tools.plugins.[pluginId].[routeName]
 * Migration examples:
 * - integrations.slack.send -> tools.plugins.slack.send
 * - integrations.discord.send -> tools.plugins.discord.send
 * - integrations.email.send -> tools.plugins.email.send
 *
 * The integrations router will be removed in a future version.
 */
export const integrationsRouter = createTRPCRouter({
  // Slack integration
  slack: createTRPCRouter({
    send: integrationProcedure
      .input(slackSendSchema)
      .mutation(async ({ ctx, input }) => {
        console.warn(
          "DEPRECATED: integrations.slack.send is deprecated. Use tools.plugins.slack.send instead.",
        );
        return withErrorHandling(
          async () => {
            const tool = await getUserTool(ctx.session.user.id, input.toolId);
            if (!tool) {
              throw notFoundError("Slack tool");
            }

            if (tool.type !== "slack") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Tool is not a Slack tool",
              });
            }

            if (!tool.isActive) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Tool is inactive",
              });
            }

            // Mock sending Slack message
            console.log(`Sending Slack message to tool ${input.toolId}:`, {
              message: input.message,
              channel: input.channel ?? tool.credentials.channel,
              username: input.username ?? tool.credentials.username,
            });

            // Simulate API call delay
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 1000 + 100),
            );

            return mutationResponse(
              {
                channel: input.channel ?? tool.credentials.channel,
                timestamp: new Date().toISOString(),
                messageId: `slack_${Date.now()}`,
              },
              "Slack message sent successfully",
            );
          },
          {
            component: "integrationsRouter",
            operationName: "slack.send",
            userId: ctx.session.user.id,
          },
        );
      }),
  }),

  // Discord integration
  discord: createTRPCRouter({
    send: integrationProcedure
      .input(discordSendSchema)
      .mutation(async ({ ctx, input }) => {
        console.warn(
          "DEPRECATED: integrations.discord.send is deprecated. Use tools.plugins.discord.send instead.",
        );
        return withErrorHandling(
          async () => {
            const tool = await getUserTool(ctx.session.user.id, input.toolId);
            if (!tool) {
              throw notFoundError("Discord tool");
            }

            if (tool.type !== "discord") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Tool is not a Discord tool",
              });
            }

            if (!tool.isActive) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Tool is inactive",
              });
            }

            // Mock sending Discord message
            console.log(`Sending Discord message to tool ${input.toolId}:`, {
              message: input.message,
              username: input.username ?? tool.credentials.username,
              embeds: input.embeds,
            });

            // Simulate API call delay
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 1000 + 100),
            );

            return mutationResponse(
              {
                timestamp: new Date().toISOString(),
                messageId: `discord_${Date.now()}`,
                embedCount: input.embeds?.length ?? 0,
              },
              "Discord message sent successfully",
            );
          },
          {
            component: "integrationsRouter",
            operationName: "discord.send",
            userId: ctx.session.user.id,
          },
        );
      }),
  }),

  // Email integration
  email: createTRPCRouter({
    send: integrationProcedure
      .input(emailSendSchema)
      .mutation(async ({ ctx, input }) => {
        console.warn(
          "DEPRECATED: integrations.email.send is deprecated. Use tools.plugins.email.send instead.",
        );
        return withErrorHandling(
          async () => {
            const tool = await getUserTool(ctx.session.user.id, input.toolId);
            if (!tool) {
              throw notFoundError("Email tool");
            }

            if (tool.type !== "email") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Tool is not an email tool",
              });
            }

            if (!tool.isActive) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Tool is inactive",
              });
            }

            // Parse recipients
            const recipientList = input.recipients
              .split(",")
              .map((email) => email.trim())
              .filter((email) => email.length > 0);

            if (recipientList.length === 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "No valid recipients provided",
              });
            }

            // Mock sending emails
            console.log(`Sending email from tool ${input.toolId}:`, {
              recipients: recipientList,
              subject: input.subject,
              message: input.message.substring(0, 100) + "...",
            });

            const results = recipientList.map((recipient) => ({
              recipient,
              success: Math.random() > 0.1, // 90% success rate
              messageId: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              timestamp: new Date().toISOString(),
            }));

            const successCount = results.filter((r) => r.success).length;
            const allSuccess = successCount === results.length;

            return mutationResponse(
              { results },
              allSuccess
                ? `Email sent successfully to ${successCount} recipient(s)`
                : `Email sent to ${successCount}/${results.length} recipients`,
            );
          },
          {
            component: "integrationsRouter",
            operationName: "email.send",
            userId: ctx.session.user.id,
          },
        );
      }),
  }),

  // Bulk sending
  bulkSend: integrationProcedure
    .input(bulkSendSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const results = [];

          for (let i = 0; i < input.messages.length; i++) {
            const message = input.messages[i];

            if (!message) {
              results.push({
                index: i,
                success: false,
                error: "Invalid message data",
                toolId: 0,
              });
              continue;
            }

            try {
              const tool = await getUserTool(
                ctx.session.user.id,
                message.toolId,
              );
              if (!tool) {
                results.push({
                  index: i,
                  success: false,
                  error: "Tool not found",
                  toolId: message.toolId,
                });
                continue;
              }

              if (!tool.isActive) {
                results.push({
                  index: i,
                  success: false,
                  error: "Tool is inactive",
                  toolId: message.toolId,
                });
                continue;
              }

              // Mock sending message
              console.log(
                `Bulk sending message ${i + 1}/${input.messages.length} via ${tool.type}`,
              );

              // Simulate success/failure (95% success rate)
              const success = Math.random() > 0.05;

              results.push({
                index: i,
                success,
                error: success ? null : "Mock failure for testing",
                toolId: message.toolId,
                toolType: tool.type,
                timestamp: new Date().toISOString(),
              });

              // Add delay between messages if specified
              if (
                i < input.messages.length - 1 &&
                input.delayBetweenMessages > 0
              ) {
                await new Promise((resolve) =>
                  setTimeout(resolve, input.delayBetweenMessages * 1000),
                );
              }

              // Stop on error if configured
              if (!success && input.stopOnError) {
                break;
              }
            } catch (error) {
              results.push({
                index: i,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                toolId: message.toolId,
              });

              if (input.stopOnError) {
                break;
              }
            }
          }

          const successCount = results.filter((r) => r.success).length;
          const totalCount = results.length;

          return mutationResponse(
            {
              results,
              summary: {
                total: totalCount,
                successful: successCount,
                failed: totalCount - successCount,
                successRate: Math.round((successCount / totalCount) * 100),
              },
            },
            `${successCount}/${totalCount} messages sent successfully`,
          );
        },
        {
          component: "integrationsRouter",
          operationName: "bulkSend",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Message history and statistics
  getMessageHistory: integrationProcedure
    .input(messageHistorySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Mock message history
          const messages = Array.from(
            { length: Math.min(input.limit, 50) },
            (_, i) => ({
              id: i + 1,
              toolId: input.toolId ?? Math.floor(Math.random() * 3) + 1,
              type:
                input.type ??
                (["email", "slack", "discord"] as const)[
                  Math.floor(Math.random() * 3)
                ],
              recipient: input.recipient ?? `recipient${i + 1}@example.com`,
              subject: `Test Message ${i + 1}`,
              content: `This is test message content ${i + 1}`,
              status: (["sent", "delivered", "failed"] as const)[
                Math.floor(Math.random() * 3)
              ],
              timestamp: new Date(
                Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              responseTime: Math.floor(Math.random() * 2000) + 100,
            }),
          );

          const pagination = normalizePagination(input);
          const result = createPaginatedResult(
            messages,
            messages.length,
            pagination,
          );
          return listResponse(result);
        },
        {
          component: "integrationsRouter",
          operationName: "getMessageHistory",
          userId: ctx.session.user.id,
        },
      );
    }),

  getMessageStats: integrationProcedure
    .input(messageStatsSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Mock message statistics
          const stats = {
            period: input.period,
            groupBy: input.groupBy,
            totalMessages: Math.floor(Math.random() * 1000) + 100,
            sentMessages: Math.floor(Math.random() * 900) + 90,
            deliveredMessages: Math.floor(Math.random() * 800) + 80,
            failedMessages: Math.floor(Math.random() * 50) + 5,
            averageResponseTime: Math.floor(Math.random() * 1000) + 200,
            byType: {
              EMAIL: Math.floor(Math.random() * 300) + 50,
              SLACK: Math.floor(Math.random() * 200) + 30,
              DISCORD: Math.floor(Math.random() * 150) + 20,
              WEBHOOK: Math.floor(Math.random() * 100) + 10,
              HTTP: Math.floor(Math.random() * 100) + 10,
            },
          };

          return statsResponse(
            {
              start: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
            },
            {
              totalMessages: stats.totalMessages,
              sentMessages: stats.sentMessages,
              deliveredMessages: stats.deliveredMessages,
              failedMessages: stats.failedMessages,
              averageResponseTime: stats.averageResponseTime,
            },
            {
              byType: Object.entries(stats.byType).map(([label, value]) => ({
                label,
                value,
              })),
            },
          );
        },
        {
          component: "integrationsRouter",
          operationName: "getMessageStats",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Test message functionality
  testMessage: integrationProcedure
    .input(testMessageSchema)
    .mutation(async ({ ctx, input }) => {
      console.warn(
        "DEPRECATED: integrations.testMessage is deprecated. Use tools.plugins.[pluginId].testConnection instead.",
      );
      return withErrorHandling(
        async () => {
          const tool = await getUserTool(ctx.session.user.id, input.toolId);
          if (!tool) {
            throw notFoundError("Tool");
          }

          if (!tool.isActive) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Tool is inactive",
            });
          }

          let message = "";
          let details: Record<string, unknown> = {};

          switch (input.testType) {
            case "connection":
              message = `${tool.type} connection test successful`;
              details = {
                toolType: tool.type,
                connectionTime: Math.floor(Math.random() * 1000) + 100,
                timestamp: new Date().toISOString(),
              };
              break;

            case "send_test_message":
              if (!input.message) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Test message content is required",
                });
              }

              message = `Test message sent successfully via ${tool.type}`;
              details = {
                toolType: tool.type,
                messageLength: input.message.length,
                recipient: input.recipient ?? "test@example.com",
                timestamp: new Date().toISOString(),
              };
              break;
          }

          // Simulate test delay
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 1000 + 100),
          );

          return mutationResponse(details, message);
        },
        {
          component: "integrationsRouter",
          operationName: "testMessage",
          userId: ctx.session.user.id,
        },
      );
    }),
});
