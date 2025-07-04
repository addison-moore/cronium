import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  toolQuerySchema,
  createToolSchema,
  updateToolSchema,
  toolIdSchema,
  testToolSchema,
  bulkToolOperationSchema,
  toolUsageSchema,
  validateToolCredentialsSchema,
  toolExportSchema,
  toolStatsSchema,
  slackCredentialsSchema,
  discordCredentialsSchema,
  emailCredentialsSchema,
  webhookCredentialsSchema,
  httpCredentialsSchema,
} from "@shared/schemas/tools";
import { storage } from "@/server/storage";
import { UserRole } from "@/shared/schema";
import { ToolType } from "@shared/schema";

// Custom procedure that handles auth for tRPC fetch adapter
const toolProcedure = publicProcedure.use(async ({ ctx, next }) => {
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
        if (adminUsers.length > 0) {
          userId = adminUsers[0]!.id;
          session = { user: { id: adminUsers[0]!.id } };
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
    console.error("Auth error in toolProcedure:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

// Helper function to get user tools (mock implementation)
async function getUserTools(userId: string) {
  // This is a mock implementation since we don't have access to the toolCredentials table
  // In a real implementation, this would query the database
  return [
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
      description: "Default Slack integration",
      tags: ["slack", "notifications"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
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
        smtpPassword: "[ENCRYPTED]",
        fromEmail: "cronium@example.com",
        fromName: "Cronium System",
        enableTLS: true,
      },
      description: "Gmail SMTP for notifications",
      tags: ["email", "smtp"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

// Helper function to validate credentials based on tool type
function validateCredentialsForType(
  type: ToolType,
  credentials: any,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    switch (type) {
      case ToolType.SLACK:
        slackCredentialsSchema.parse(credentials);
        break;
      case ToolType.DISCORD:
        discordCredentialsSchema.parse(credentials);
        break;
      case ToolType.EMAIL:
        emailCredentialsSchema.parse(credentials);
        break;
      case ToolType.WEBHOOK:
        webhookCredentialsSchema.parse(credentials);
        break;
      case ToolType.HTTP:
        httpCredentialsSchema.parse(credentials);
        break;
      default:
        errors.push("Unsupported tool type");
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      errors.push(
        ...error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      );
    } else {
      errors.push("Invalid credentials format");
    }
  }

  return { valid: errors.length === 0, errors };
}

export const toolsRouter = createTRPCRouter({
  // Get all user tools
  getAll: toolProcedure.input(toolQuerySchema).query(async ({ ctx, input }) => {
    try {
      const tools = await getUserTools(ctx.userId);

      // Apply filters
      let filteredTools = tools;

      if (input.type) {
        filteredTools = filteredTools.filter(
          (tool) => tool.type === input.type,
        );
      }

      if (input.search) {
        const searchLower = input.search.toLowerCase();
        filteredTools = filteredTools.filter(
          (tool) =>
            tool.name.toLowerCase().includes(searchLower) ||
            tool.description?.toLowerCase().includes(searchLower) ||
            tool.tags.some((tag) => tag.toLowerCase().includes(searchLower)),
        );
      }

      // Apply sorting
      filteredTools.sort((a, b) => {
        let aValue: any, bValue: any;

        switch (input.sortBy) {
          case "name":
            aValue = a.name;
            bValue = b.name;
            break;
          case "type":
            aValue = a.type;
            bValue = b.type;
            break;
          case "createdAt":
            aValue = a.createdAt;
            bValue = b.createdAt;
            break;
          case "updatedAt":
            aValue = a.updatedAt;
            bValue = b.updatedAt;
            break;
          default:
            aValue = a.name;
            bValue = b.name;
        }

        if (input.sortOrder === "desc") {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        } else {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        }
      });

      // Apply pagination
      const paginatedTools = filteredTools.slice(
        input.offset,
        input.offset + input.limit,
      );

      // Hide sensitive credential data in list view
      const sanitizedTools = paginatedTools.map((tool) => ({
        ...tool,
        credentials: Object.keys(tool.credentials).reduce(
          (acc, key) => {
            if (
              key.toLowerCase().includes("password") ||
              key.toLowerCase().includes("token") ||
              key.toLowerCase().includes("secret")
            ) {
              acc[key] = "[HIDDEN]";
            } else {
              acc[key] = (tool.credentials as Record<string, unknown>)[key];
            }
            return acc;
          },
          {} as Record<string, unknown>,
        ),
      }));

      return {
        tools: sanitizedTools,
        total: filteredTools.length,
        hasMore: input.offset + input.limit < filteredTools.length,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch tools",
        cause: error,
      });
    }
  }),

  // Get single tool by ID
  getById: toolProcedure.input(toolIdSchema).query(async ({ ctx, input }) => {
    try {
      const tools = await getUserTools(ctx.userId);
      const tool = tools.find((t) => t.id === input.id);

      if (!tool) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
      }

      return tool;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch tool",
        cause: error,
      });
    }
  }),

  // Create new tool
  create: toolProcedure
    .input(createToolSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Validate credentials for the tool type
        const validation = validateCredentialsForType(
          input.type,
          input.credentials,
        );
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid credentials: ${validation.errors.join(", ")}`,
          });
        }

        // Check if tool with this name already exists
        const existingTools = await getUserTools(ctx.userId);
        if (existingTools.some((tool) => tool.name === input.name)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A tool with this name already exists",
          });
        }

        // Mock creating tool - in real implementation, this would use storage
        const newTool = {
          id: Math.max(...existingTools.map((t) => t.id), 0) + 1,
          userId: ctx.userId,
          name: input.name,
          type: input.type,
          credentials: input.credentials,
          description: input.description,
          tags: input.tags,
          isActive: input.isActive,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // TODO: Encrypt credentials before storing
        console.log(
          `Created tool "${input.name}" of type ${input.type} for user ${ctx.userId}`,
        );

        return newTool;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create tool",
          cause: error,
        });
      }
    }),

  // Update existing tool
  update: toolProcedure
    .input(updateToolSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...updateData } = input;

        const tools = await getUserTools(ctx.userId);
        const existingTool = tools.find((t) => t.id === id);

        if (!existingTool) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
        }

        // Validate credentials if provided
        if (updateData.credentials) {
          const validation = validateCredentialsForType(
            existingTool.type,
            updateData.credentials,
          );
          if (!validation.valid) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid credentials: ${validation.errors.join(", ")}`,
            });
          }
        }

        // Check for name conflicts if name is being updated
        if (updateData.name && updateData.name !== existingTool.name) {
          if (
            tools.some(
              (tool) => tool.id !== id && tool.name === updateData.name,
            )
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A tool with this name already exists",
            });
          }
        }

        // Mock updating tool
        const updatedTool = {
          ...existingTool,
          ...updateData,
          updatedAt: new Date(),
        };

        console.log(`Updated tool ${id} for user ${ctx.userId}`);

        return updatedTool;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update tool",
          cause: error,
        });
      }
    }),

  // Delete tool
  delete: toolProcedure.input(toolIdSchema).mutation(async ({ ctx, input }) => {
    try {
      const tools = await getUserTools(ctx.userId);
      const tool = tools.find((t) => t.id === input.id);

      if (!tool) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
      }

      // Mock deleting tool
      console.log(`Deleted tool ${input.id} for user ${ctx.userId}`);

      return { success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to delete tool",
        cause: error,
      });
    }
  }),

  // Test tool connection
  test: toolProcedure.input(testToolSchema).mutation(async ({ ctx, input }) => {
    try {
      const tools = await getUserTools(ctx.userId);
      const tool = tools.find((t) => t.id === input.id);

      if (!tool) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
      }

      // Mock testing tool connection
      const testResults = {
        success: true,
        message: `${tool.type} connection test successful`,
        details: {
          toolType: tool.type,
          toolName: tool.name,
          testDuration: Math.floor(Math.random() * 1000) + 100, // 100-1100ms
          timestamp: new Date().toISOString(),
        } as {
          toolType: ToolType;
          toolName: string;
          testDuration: number;
          timestamp: string;
          [key: string]: any; // Allow additional properties
        },
      };

      // Add type-specific test details
      switch (tool.type) {
        case ToolType.SLACK:
          testResults.details = {
            ...testResults.details,
            webhookUrl: tool.credentials.webhookUrl ? "Valid" : "Invalid",
            channel: tool.credentials.channel || "Default",
          };
          break;
        case ToolType.EMAIL:
          testResults.details = {
            ...testResults.details,
            smtpHost: tool.credentials.smtpHost,
            smtpPort: tool.credentials.smtpPort,
            authenticationTest: "Passed",
          };
          break;
        case ToolType.DISCORD:
          testResults.details = {
            ...testResults.details,
            webhookUrl: tool.credentials.webhookUrl ? "Valid" : "Invalid",
          };
          break;
      }

      return testResults;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to test tool",
        cause: error,
      });
    }
  }),

  // Validate tool credentials
  validateCredentials: toolProcedure
    .input(validateToolCredentialsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validation = validateCredentialsForType(
          input.type,
          input.credentials,
        );

        const result = {
          valid: validation.valid,
          errors: validation.errors,
          warnings: [] as string[],
          suggestions: [] as string[],
        };

        // Add type-specific warnings and suggestions
        if (validation.valid && input.testConnection) {
          // Mock connection test
          result.suggestions.push("Connection test would be performed here");
        }

        return result;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to validate credentials",
          cause: error,
        });
      }
    }),

  // Get tool usage in events and workflows
  getUsage: toolProcedure
    .input(toolUsageSchema)
    .query(async ({ ctx, input }) => {
      try {
        const tools = await getUserTools(ctx.userId);
        const tool = tools.find((t) => t.id === input.toolId);

        if (!tool) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
        }

        // Mock usage data
        const usage = {
          events: input.includeEvents
            ? [
                {
                  id: 1,
                  name: "Daily Report Email",
                  type: "email",
                  status: "ACTIVE",
                },
                {
                  id: 2,
                  name: "Alert Notifications",
                  type: "script",
                  status: "ACTIVE",
                },
              ]
            : [],
          workflows: input.includeWorkflows
            ? [{ id: 1, name: "Deployment Pipeline", status: "ACTIVE" }]
            : [],
          templates: input.includeTemplates
            ? [{ id: 1, name: "Error Alert Template", type: tool.type }]
            : [],
          totalUsages: 0,
        };

        usage.totalUsages =
          usage.events.length + usage.workflows.length + usage.templates.length;

        return usage;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get tool usage",
          cause: error,
        });
      }
    }),

  // Bulk operations on tools
  bulkOperation: toolProcedure
    .input(bulkToolOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const results = [];
        const tools = await getUserTools(ctx.userId);

        for (const toolId of input.toolIds) {
          try {
            const tool = tools.find((t) => t.id === toolId);
            if (!tool) {
              results.push({
                id: toolId,
                success: false,
                error: "Tool not found",
              });
              continue;
            }

            switch (input.operation) {
              case "delete":
                // Mock delete
                results.push({ id: toolId, success: true });
                break;
              case "activate":
                // Mock activate
                results.push({ id: toolId, success: true });
                break;
              case "deactivate":
                // Mock deactivate
                results.push({ id: toolId, success: true });
                break;
              case "test":
                // Mock test
                results.push({
                  id: toolId,
                  success: true,
                  message: `${tool.type} connection test successful`,
                });
                break;
            }
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            results.push({ id: toolId, success: false, error: errorMessage });
          }
        }

        return { results };
      } catch (error: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
          cause: error,
        });
      }
    }),

  // Export tools
  export: toolProcedure
    .input(toolExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const tools = await getUserTools(ctx.userId);
        const toolsToExport = tools.filter((t) => input.toolIds.includes(t.id));

        if (toolsToExport.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No tools found to export",
          });
        }

        // Prepare export data
        const exportData = toolsToExport.map((tool) => ({
          name: tool.name,
          type: tool.type,
          description: tool.description,
          tags: tool.tags,
          isActive: input.includeInactive || tool.isActive,
          credentials: input.includeCredentials ? tool.credentials : undefined,
        }));

        let fileContent: string;
        let filename: string;

        switch (input.format) {
          case "json":
            fileContent = JSON.stringify(exportData, null, 2);
            filename = `tools_${new Date().toISOString().split("T")[0]}.json`;
            break;
          case "yaml":
            // Mock YAML export - in real implementation, use a YAML library
            fileContent = `# Tools Export\ntools:\n${exportData.map((tool) => `  - name: "${tool.name}"\n    type: "${tool.type}"`).join("\n")}`;
            filename = `tools_${new Date().toISOString().split("T")[0]}.yaml`;
            break;
          default:
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid export format",
            });
        }

        return {
          data: fileContent,
          filename,
          format: input.format,
          count: toolsToExport.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to export tools",
          cause: error,
        });
      }
    }),

  // Get tool statistics
  getStats: toolProcedure
    .input(toolStatsSchema)
    .query(async ({ ctx, input }) => {
      try {
        const tools = await getUserTools(ctx.userId);
        let targetTools = tools;

        if (input.toolId) {
          targetTools = tools.filter((t) => t.id === input.toolId);
          if (targetTools.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Tool not found",
            });
          }
        }

        // Mock statistics
        const stats = {
          period: input.period,
          groupBy: input.groupBy,
          totalTools: targetTools.length,
          activeTools: targetTools.filter((t) => t.isActive).length,
          inactiveTools: targetTools.filter((t) => !t.isActive).length,
          byType: {
            [ToolType.SLACK]: targetTools.filter(
              (t) => t.type === ToolType.SLACK,
            ).length,
            [ToolType.DISCORD]: targetTools.filter(
              (t) => t.type === ToolType.DISCORD,
            ).length,
            [ToolType.EMAIL]: targetTools.filter(
              (t) => t.type === ToolType.EMAIL,
            ).length,
            [ToolType.WEBHOOK]: targetTools.filter(
              (t) => t.type === ToolType.WEBHOOK,
            ).length,
            [ToolType.HTTP]: targetTools.filter((t) => t.type === ToolType.HTTP)
              .length,
          },
          usage: {
            totalMessages: Math.floor(Math.random() * 1000) + 100,
            successfulMessages: Math.floor(Math.random() * 900) + 90,
            failedMessages: Math.floor(Math.random() * 50) + 5,
            averageResponseTime: Math.floor(Math.random() * 1000) + 200,
          },
        };

        return stats;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get tool statistics",
          cause: error,
        });
      }
    }),
});
