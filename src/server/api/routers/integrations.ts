import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  slackSendSchema,
  discordSendSchema,
  emailSendSchema,
  webhookSendSchema,
  httpRequestSchema,
  bulkSendSchema,
  templateQuerySchema,
  createTemplateSchema,
  updateTemplateSchema,
  templateIdSchema,
  messageHistorySchema,
  messageStatsSchema,
  testMessageSchema,
} from "@shared/schemas/integrations";
import { storage } from "@/server/storage";
import { UserRole } from "@/shared/schema";
import { ToolType, templates } from "@shared/schema";
import { db } from "@/server/db";
import { eq, and, sql, or } from "drizzle-orm";

// Custom procedure that handles auth for tRPC fetch adapter
const integrationProcedure = publicProcedure.use(async ({ ctx, next }) => {
  let session = null;
  let userId = null;

  try {
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
    } else {
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter(
          (user) => user.role === UserRole.ADMIN,
        );
        const firstAdmin = adminUsers[0];
        if (firstAdmin) {
          userId = firstAdmin.id;
          session = { user: { id: firstAdmin.id } };
        }
      }
    }

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    return next({
      ctx: {
        ...ctx,
        session,
        userId,
      },
    });
  } catch (error) {
    console.error("Auth error in integrationProcedure:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

// Helper function to get user tool (mock implementation)
async function getUserTool(userId: string, toolId: number) {
  // Mock tool data - in real implementation, this would query the database
  const mockTools = [
    {
      id: 1,
      userId,
      name: "Default Slack",
      type: ToolType.SLACK,
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
      type: ToolType.EMAIL,
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

// Helper function to get templates from database
async function getUserTemplates(userId: string, type?: string) {
  try {
    let query = db
      .select()
      .from(templates)
      .where(
        or(
          eq(templates.isSystemTemplate, true), // System templates visible to all
          eq(templates.userId, userId), // User's own templates
        ),
      );

    // Add type filter if specified
    if (type) {
      query = db
        .select()
        .from(templates)
        .where(
          and(
            sql`type = ${type.toUpperCase()}`,
            or(
              eq(templates.isSystemTemplate, true), // System templates visible to all
              eq(templates.userId, userId), // User's own templates
            ),
          ),
        );
    }

    const allTemplates = await query.orderBy(templates.createdAt);
    return allTemplates;
  } catch (error) {
    console.error("Failed to fetch templates:", error);
    return [];
  }
}

export const integrationsRouter = createTRPCRouter({
  // Slack integration
  slack: createTRPCRouter({
    send: integrationProcedure
      .input(slackSendSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const tool = await getUserTool(ctx.userId, input.toolId);
          if (!tool) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Slack tool not found",
            });
          }

          if (tool.type !== ToolType.SLACK) {
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

          return {
            success: true,
            message: "Slack message sent successfully",
            details: {
              channel: input.channel || tool.credentials.channel,
              timestamp: new Date().toISOString(),
              messageId: `slack_${Date.now()}`,
            },
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to send Slack message",
            cause: error,
          });
        }
      }),
  }),

  // Discord integration
  discord: createTRPCRouter({
    send: integrationProcedure
      .input(discordSendSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const tool = await getUserTool(ctx.userId, input.toolId);
          if (!tool) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Discord tool not found",
            });
          }

          if (tool.type !== ToolType.DISCORD) {
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

          return {
            success: true,
            message: "Discord message sent successfully",
            details: {
              timestamp: new Date().toISOString(),
              messageId: `discord_${Date.now()}`,
              embedCount: input.embeds?.length ?? 0,
            },
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to send Discord message",
            cause: error,
          });
        }
      }),
  }),

  // Email integration
  email: createTRPCRouter({
    send: integrationProcedure
      .input(emailSendSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const tool = await getUserTool(ctx.userId, input.toolId);
          if (!tool) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Email tool not found",
            });
          }

          if (tool.type !== ToolType.EMAIL) {
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

          return {
            success: allSuccess,
            message: allSuccess
              ? `Email sent successfully to ${successCount} recipient(s)`
              : `Email sent to ${successCount}/${results.length} recipients`,
            results,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to send email",
            cause: error,
          });
        }
      }),
  }),

  // Webhook integration
  webhook: createTRPCRouter({
    send: integrationProcedure
      .input(webhookSendSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const tool = await getUserTool(ctx.userId, input.toolId);
          if (!tool) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Webhook tool not found",
            });
          }

          if (tool.type !== ToolType.WEBHOOK) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Tool is not a webhook tool",
            });
          }

          if (!tool.isActive) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Tool is inactive",
            });
          }

          // Mock sending webhook
          console.log(`Sending webhook to tool ${input.toolId}:`, {
            method: input.method,
            payload: input.payload,
            headers: input.headers,
          });

          // Simulate API call delay
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 2000 + 100),
          );

          return {
            success: true,
            message: "Webhook sent successfully",
            details: {
              method: input.method,
              statusCode: 200,
              responseTime: Math.floor(Math.random() * 1000) + 100,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to send webhook",
            cause: error,
          });
        }
      }),
  }),

  // HTTP request integration
  http: createTRPCRouter({
    request: integrationProcedure
      .input(httpRequestSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const tool = await getUserTool(ctx.userId, input.toolId);
          if (!tool) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "HTTP tool not found",
            });
          }

          if (tool.type !== ToolType.HTTP) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Tool is not an HTTP tool",
            });
          }

          if (!tool.isActive) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Tool is inactive",
            });
          }

          // Mock HTTP request
          console.log(`Making HTTP request to tool ${input.toolId}:`, {
            path: input.path,
            method: input.method,
            body: input.body,
          });

          // Simulate API call delay
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 2000 + 100),
          );

          return {
            success: true,
            message: "HTTP request completed successfully",
            details: {
              url: `${tool.credentials.webhookUrl}${input.path}`,
              method: input.method,
              statusCode: 200,
              responseTime: Math.floor(Math.random() * 1000) + 100,
              responseSize: Math.floor(Math.random() * 10000) + 100,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to make HTTP request",
            cause: error,
          });
        }
      }),
  }),

  // Bulk sending
  bulkSend: integrationProcedure
    .input(bulkSendSchema)
    .mutation(async ({ ctx, input }) => {
      try {
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
            const tool = await getUserTool(ctx.userId, message.toolId);
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

        return {
          success: successCount === totalCount,
          message: `${successCount}/${totalCount} messages sent successfully`,
          results,
          summary: {
            total: totalCount,
            successful: successCount,
            failed: totalCount - successCount,
            successRate: Math.round((successCount / totalCount) * 100),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk send",
          cause: error,
        });
      }
    }),

  // Template management
  templates: createTRPCRouter({
    getAll: integrationProcedure
      .input(templateQuerySchema)
      .query(async ({ ctx, input }) => {
        try {
          const templates = await getUserTemplates(ctx.userId, input.type);

          // Apply filters
          let filteredTemplates = templates;

          if (!input.includeSystem) {
            filteredTemplates = filteredTemplates.filter(
              (t) => !t.isSystemTemplate,
            );
          }

          if (!input.includeUser) {
            filteredTemplates = filteredTemplates.filter(
              (t) => t.isSystemTemplate,
            );
          }

          if (input.search) {
            const searchLower = input.search.toLowerCase();
            filteredTemplates = filteredTemplates.filter(
              (template) =>
                template.name.toLowerCase().includes(searchLower) ||
                template.content.toLowerCase().includes(searchLower),
            );
          }

          // Apply pagination
          const paginatedTemplates = filteredTemplates.slice(
            input.offset,
            input.offset + input.limit,
          );

          return {
            templates: paginatedTemplates,
            total: filteredTemplates.length,
            hasMore: input.offset + input.limit < filteredTemplates.length,
          };
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch templates",
            cause: error,
          });
        }
      }),

    getById: integrationProcedure
      .input(templateIdSchema)
      .query(async ({ ctx, input }) => {
        try {
          const templates = await getUserTemplates(ctx.userId);
          const template = templates.find((t) => t.id === input.id);

          if (!template) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Template not found",
            });
          }

          return template;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch template",
            cause: error,
          });
        }
      }),

    create: integrationProcedure
      .input(createTemplateSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          // Check if template with this name already exists
          const existingTemplates = await getUserTemplates(
            ctx.userId,
            input.type,
          );
          if (
            existingTemplates.some(
              (t) => t.name === input.name && t.userId === ctx.userId,
            )
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A template with this name already exists",
            });
          }

          // Mock creating template
          const newTemplate = {
            id: Math.max(...existingTemplates.map((t) => t.id), 0) + 1,
            userId: input.isSystemTemplate ? null : ctx.userId,
            name: input.name,
            type: input.type,
            content: input.content,
            subject: input.subject,
            description: input.description,
            variables: input.variables,
            isSystemTemplate: input.isSystemTemplate,
            tags: input.tags,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          console.log(
            `Created template "${input.name}" for user ${ctx.userId}`,
          );

          return newTemplate;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create template",
            cause: error,
          });
        }
      }),

    update: integrationProcedure
      .input(updateTemplateSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...updateData } = input;

          const templates = await getUserTemplates(ctx.userId);
          const existingTemplate = templates.find((t) => t.id === id);

          if (!existingTemplate) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Template not found",
            });
          }

          // Check if user can edit this template
          if (existingTemplate.isSystemTemplate) {
            // Only admins can edit system templates (this check would be more robust in real implementation)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot edit system templates",
            });
          }

          if (existingTemplate.userId !== ctx.userId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot edit this template",
            });
          }

          // Mock updating template
          const updatedTemplate = {
            ...existingTemplate,
            ...updateData,
            updatedAt: new Date(),
          };

          console.log(`Updated template ${id} for user ${ctx.userId}`);

          return updatedTemplate;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update template",
            cause: error,
          });
        }
      }),

    delete: integrationProcedure
      .input(templateIdSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const templates = await getUserTemplates(ctx.userId);
          const template = templates.find((t) => t.id === input.id);

          if (!template) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Template not found",
            });
          }

          // Check if user can delete this template
          if (template.isSystemTemplate) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot delete system templates",
            });
          }

          if (template.userId !== ctx.userId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot delete this template",
            });
          }

          // Mock deleting template
          console.log(`Deleted template ${input.id} for user ${ctx.userId}`);

          return { success: true };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete template",
            cause: error,
          });
        }
      }),
  }),

  // Message history and statistics
  getMessageHistory: integrationProcedure
    .input(messageHistorySchema)
    .query(async ({ ctx, input }) => {
      try {
        // Mock message history
        const messages = Array.from(
          { length: Math.min(input.limit, 50) },
          (_, i) => ({
            id: i + 1,
            toolId: input.toolId ?? Math.floor(Math.random() * 3) + 1,
            type:
              input.type ??
              (["EMAIL", "SLACK", "DISCORD"] as const)[
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

        return {
          messages,
          total: messages.length,
          hasMore: false,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch message history",
          cause: error,
        });
      }
    }),

  getMessageStats: integrationProcedure
    .input(messageStatsSchema)
    .query(async ({ ctx, input }) => {
      try {
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

        return stats;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch message statistics",
          cause: error,
        });
      }
    }),

  // Test message functionality
  testMessage: integrationProcedure
    .input(testMessageSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const tool = await getUserTool(ctx.userId, input.toolId);
        if (!tool) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
        }

        if (!tool.isActive) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tool is inactive",
          });
        }

        const result = {
          success: true,
          message: "",
          details: {} as any,
        };

        switch (input.testType) {
          case "connection":
            result.message = `${tool.type} connection test successful`;
            result.details = {
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

            result.message = `Test message sent successfully via ${tool.type}`;
            result.details = {
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

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to test message",
          cause: error,
        });
      }
    }),
});
