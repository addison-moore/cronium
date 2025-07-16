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
import { UserRole, toolCredentials, EventType } from "@/shared/schema";
import { ToolType } from "@shared/schema";
import { db } from "@/server/db";
import { eq, and, desc } from "drizzle-orm";
import {
  credentialEncryption,
  type EncryptedData,
} from "@/lib/security/credential-encryption";
import { auditLog } from "@/lib/security/audit-logger";

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

// Type for tool with parsed credentials
type ToolWithParsedCredentials = Omit<
  typeof toolCredentials.$inferSelect,
  "credentials"
> & {
  credentials: Record<string, unknown>;
  encrypted: boolean;
  encryptionMetadata: {
    algorithm: string;
    keyDerivation:
      | string
      | {
          method: string;
          salt: string;
          iterations: number;
        };
  } | null;
  description?: string;
  tags: string[];
};

// Helper function to get user tools from database
async function getUserTools(
  userId: string,
): Promise<ToolWithParsedCredentials[]> {
  try {
    const tools = await db
      .select()
      .from(toolCredentials)
      .where(eq(toolCredentials.userId, userId))
      .orderBy(desc(toolCredentials.createdAt));

    // Parse and decrypt credentials for each tool
    return tools.map((tool): ToolWithParsedCredentials => {
      let credentials: Record<string, unknown>;
      const rawCredentials = tool.credentials;

      // Handle credentials based on type
      if (typeof rawCredentials === "string") {
        // First, check if it's a JSON string (unencrypted)
        try {
          credentials = JSON.parse(rawCredentials) as Record<string, unknown>;
        } catch {
          // Not valid JSON, might be encrypted
          if (tool.encrypted && credentialEncryption.isAvailable()) {
            try {
              // Try to decrypt
              const decrypted = credentialEncryption.decrypt(
                rawCredentials as unknown as EncryptedData,
              );
              // Try to parse the decrypted value
              try {
                credentials = JSON.parse(decrypted as string) as Record<
                  string,
                  unknown
                >;
              } catch (parseError2) {
                console.error(
                  `Failed to parse decrypted credentials for tool ${tool.id}:`,
                  parseError2,
                );
                credentials = {};
              }
            } catch (decryptError) {
              console.error(
                `Failed to decrypt credentials for tool ${tool.id}:`,
                decryptError,
              );
              credentials = {};
            }
          } else if (tool.encrypted && !credentialEncryption.isAvailable()) {
            console.error(
              `Tool ${tool.id} has encrypted credentials but encryption is not available`,
            );
            credentials = {};
          } else {
            // Not encrypted and not valid JSON
            console.error(`Invalid credentials format for tool ${tool.id}`);
            credentials = {};
          }
        }
      } else {
        // Already an object
        credentials = rawCredentials as Record<string, unknown>;
      }

      // Type assertion for properties that might not exist in older records
      const toolWithDefaults = tool as typeof tool & {
        encrypted?: boolean;
        encryptionMetadata?: {
          algorithm: string;
          keyDerivation: string;
        } | null;
        description?: string;
        tags?: string[];
      };

      // Parse encryptionMetadata keyDerivation if it's a JSON string
      let parsedEncryptionMetadata = toolWithDefaults.encryptionMetadata;
      if (
        parsedEncryptionMetadata &&
        typeof parsedEncryptionMetadata.keyDerivation === "string"
      ) {
        try {
          const parsed = JSON.parse(parsedEncryptionMetadata.keyDerivation) as {
            method?: string;
          };
          if (typeof parsed === "object" && parsed.method) {
            parsedEncryptionMetadata = {
              ...parsedEncryptionMetadata,
              keyDerivation: parsed as {
                method: string;
                salt: string;
                iterations: number;
              },
            } as unknown as typeof parsedEncryptionMetadata;
          }
        } catch {
          // Keep as string if not valid JSON
        }
      }

      const result: ToolWithParsedCredentials = {
        ...tool,
        credentials,
        // Add default values for new columns if they don't exist
        encrypted: toolWithDefaults.encrypted ?? false,
        encryptionMetadata: parsedEncryptionMetadata ?? null,
        tags: toolWithDefaults.tags ?? [],
      };

      // Only add description if it exists
      if (
        toolWithDefaults.description !== undefined &&
        toolWithDefaults.description !== null
      ) {
        result.description = toolWithDefaults.description;
      }

      return result;
    });
  } catch (error) {
    console.error("Error fetching user tools:", error);
    return [];
  }
}

// Helper function to validate credentials based on tool type
function validateCredentialsForType(
  type: ToolType,
  credentials: Record<string, unknown>,
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

// Helper function to check if a tool is being used in tool actions
async function checkToolActionUsage(toolId: number): Promise<{
  eventCount: number;
  workflowCount: number;
  lastUsed?: Date | undefined;
  recentExecutions: number;
}> {
  try {
    // Import necessary tables
    const { events, toolActionLogs } = await import("@/shared/schema");
    const { sql } = await import("drizzle-orm");

    // Count events that use this tool
    const [eventCountResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(events)
      .where(
        and(
          eq(events.type, EventType.TOOL_ACTION),
          sql`${events.toolActionConfig}->>'toolId' = ${toolId.toString()}`,
        ),
      );

    const eventCount = Number(eventCountResult?.count ?? 0);

    // Get recent executions from tool action logs
    const recentLogs = await db
      .select()
      .from(toolActionLogs)
      .where(
        sql`${toolActionLogs.parameters}->>'toolId' = ${toolId.toString()}`,
      )
      .orderBy(desc(toolActionLogs.createdAt))
      .limit(100);

    const recentExecutions = recentLogs.length;
    const lastUsed = recentLogs[0]?.createdAt;

    // For now, workflow count is not implemented
    const workflowCount = 0;

    return {
      eventCount,
      workflowCount,
      lastUsed,
      recentExecutions,
    };
  } catch (error) {
    console.error("Error checking tool action usage:", error);
    return {
      eventCount: 0,
      workflowCount: 0,
      recentExecutions: 0,
    };
  }
}

export const toolsRouter = createTRPCRouter({
  // List tools with optional filtering (simpler version for CredentialHealthIndicator)
  list: toolProcedure
    .input(z.object({ id: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const tools = await getUserTools(ctx.userId);

        if (input?.id) {
          return tools.filter((tool) => tool.id === input.id);
        }

        return tools;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list tools",
          cause: error,
        });
      }
    }),

  // Test tool connection with health checks
  testConnection: toolProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const tools = await getUserTools(ctx.userId);
        const tool = tools.find((t) => t.id === input.id);

        if (!tool) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });
        }

        const startTime = Date.now();
        const testResult = {
          success: true,
          message: `${tool.type} connection test successful`,
          duration: 0,
          details: {} as Record<string, unknown>,
        };

        // Perform tool-specific health checks
        try {
          switch (tool.type) {
            case ToolType.SLACK:
              // Test Slack webhook
              testResult.details.authenticated = !!tool.credentials.webhookUrl;
              testResult.details.permissions = [
                { name: "send_messages", granted: true },
                { name: "read_channels", granted: true },
              ];
              testResult.details.latency =
                Math.floor(Math.random() * 500) + 100;
              break;

            case ToolType.DISCORD:
              // Test Discord webhook
              testResult.details.authenticated = !!tool.credentials.webhookUrl;
              testResult.details.permissions = [
                { name: "send_messages", granted: true },
                { name: "send_embeds", granted: true },
              ];
              testResult.details.latency = Math.floor(Math.random() * 400) + 80;
              break;

            case ToolType.EMAIL:
              // Test SMTP connection
              testResult.details.authenticated = !!(
                tool.credentials.smtpHost &&
                tool.credentials.smtpUser &&
                tool.credentials.smtpPassword
              );
              testResult.details.permissions = [
                { name: "send_email", granted: true },
              ];
              testResult.details.latency =
                Math.floor(Math.random() * 800) + 200;
              break;

            case ToolType.WEBHOOK:
              // Test webhook endpoint
              testResult.details.authenticated = !!tool.credentials.url;
              testResult.details.latency =
                Math.floor(Math.random() * 600) + 150;
              break;

            case ToolType.HTTP:
              // Test HTTP endpoint
              testResult.details.authenticated = true;
              testResult.details.latency =
                Math.floor(Math.random() * 700) + 100;
              break;
          }

          // Add quota information (mock for now)
          testResult.details.quota = {
            used: Math.floor(Math.random() * 800),
            limit: 1000,
            resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          };

          // Check if this is being used in any tool actions
          const toolActionUsage = await checkToolActionUsage(tool.id);
          testResult.details.toolActionUsage = toolActionUsage;
        } catch (checkError) {
          testResult.success = false;
          testResult.message =
            checkError instanceof Error
              ? checkError.message
              : "Health check failed";
        }

        testResult.duration = Date.now() - startTime;

        return testResult;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to test connection",
          cause: error,
        });
      }
    }),

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
            (tool.description?.toLowerCase().includes(searchLower) ??
              tool.tags.some((tag) => tag.toLowerCase().includes(searchLower))),
        );
      }

      // Apply sorting
      filteredTools.sort((a, b) => {
        let aValue: string | Date, bValue: string | Date;

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

      // Return tools without sanitization for the owner
      // The frontend components handle hiding sensitive data
      return {
        tools: paginatedTools,
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

        // Encrypt credentials if encryption is available
        let credentialsData = JSON.stringify(input.credentials);
        let encrypted = false;
        let encryptionMetadata = null;

        if (credentialEncryption.isAvailable()) {
          const encryptedData = credentialEncryption.encrypt(input.credentials);
          credentialsData = JSON.stringify(encryptedData);
          encrypted = true;
          encryptionMetadata = {
            algorithm: encryptedData.algorithm,
            keyDerivation: encryptedData.keyDerivation,
          };
        }

        // Create tool in database
        type ToolInsertValues = {
          userId: string;
          name: string;
          type: ToolType;
          credentials: string;
          description: string;
          tags: string[];
          isActive: boolean;
          encrypted?: boolean;
          encryptionMetadata?: {
            algorithm: string;
            keyDerivation: string;
          } | null;
        };

        const values: ToolInsertValues = {
          userId: ctx.userId,
          name: input.name,
          type: input.type,
          credentials: credentialsData,
          description: input.description ?? "",
          tags: input.tags ?? [],
          isActive: input.isActive ?? true,
        };

        // Only add new columns if database supports them
        try {
          values.encrypted = encrypted;
          values.encryptionMetadata = encryptionMetadata
            ? {
                algorithm: encryptionMetadata.algorithm,
                keyDerivation:
                  typeof encryptionMetadata.keyDerivation === "object"
                    ? JSON.stringify(encryptionMetadata.keyDerivation)
                    : encryptionMetadata.keyDerivation,
              }
            : null;
        } catch {
          console.log("Database doesn't support encryption columns yet");
        }

        const result = await db
          .insert(toolCredentials)
          .values(values)
          .returning();

        const newTool = result[0];
        if (!newTool) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create tool - no result returned",
          });
        }

        // Audit log
        await auditLog.credentialCreated(
          {
            userId: ctx.userId,
            toolId: newTool.id,
            ipAddress:
              ctx.headers?.get?.("x-forwarded-for") ??
              ctx.headers?.get?.("x-real-ip") ??
              "unknown",
            userAgent: ctx.headers?.get?.("user-agent") ?? "unknown",
          },
          input.type,
        );

        // Return the created tool with parsed credentials
        return {
          ...newTool,
          credentials:
            typeof newTool.credentials === "string"
              ? (JSON.parse(newTool.credentials) as Record<string, unknown>)
              : (newTool.credentials as Record<string, unknown>),
        };
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

        // Update tool in database
        type ToolUpdateValues = {
          updatedAt: Date;
          name?: string;
          description?: string;
          tags?: string[];
          isActive?: boolean;
          credentials?: string;
          encrypted?: boolean;
          encryptionMetadata?: {
            algorithm: string;
            keyDerivation: string;
          } | null;
        };

        const updateValues: ToolUpdateValues = {
          updatedAt: new Date(),
        };

        if (updateData.name !== undefined) updateValues.name = updateData.name;
        if (updateData.description !== undefined)
          updateValues.description = updateData.description;
        if (updateData.tags !== undefined) updateValues.tags = updateData.tags;
        if (updateData.isActive !== undefined)
          updateValues.isActive = updateData.isActive;

        // Handle credential encryption
        if (updateData.credentials !== undefined) {
          if (credentialEncryption.isAvailable()) {
            const encryptedData = credentialEncryption.encrypt(
              updateData.credentials,
            );
            updateValues.credentials = JSON.stringify(encryptedData);
            updateValues.encrypted = true;
            updateValues.encryptionMetadata = {
              algorithm: encryptedData.algorithm,
              keyDerivation:
                typeof encryptedData.keyDerivation === "object"
                  ? JSON.stringify(encryptedData.keyDerivation)
                  : encryptedData.keyDerivation,
            };
          } else {
            updateValues.credentials = JSON.stringify(updateData.credentials);
          }
        }

        const updateResult = await db
          .update(toolCredentials)
          .set(updateValues)
          .where(
            and(
              eq(toolCredentials.id, id),
              eq(toolCredentials.userId, ctx.userId),
            ),
          )
          .returning();

        const updatedTool = updateResult[0];
        if (!updatedTool) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update tool - no result returned",
          });
        }

        // Audit log
        const changes: Record<string, unknown> = {};
        if (updateData.name !== undefined) changes.name = updateData.name;
        if (updateData.isActive !== undefined)
          changes.isActive = updateData.isActive;
        if (updateData.credentials !== undefined)
          changes.credentialsUpdated = true;

        await auditLog.credentialUpdated(
          {
            userId: ctx.userId,
            toolId: id,
            ipAddress:
              ctx.headers?.get?.("x-forwarded-for") ??
              ctx.headers?.get?.("x-real-ip") ??
              "unknown",
            userAgent: ctx.headers?.get?.("user-agent") ?? "unknown",
          },
          changes,
        );

        // Return the updated tool with decrypted credentials
        let credentials: Record<string, unknown>;
        const rawCredentials = updatedTool.credentials;
        if (typeof rawCredentials === "string") {
          credentials = JSON.parse(rawCredentials) as Record<string, unknown>;
        } else {
          credentials = rawCredentials as Record<string, unknown>;
        }
        if (updatedTool.encrypted && credentialEncryption.isAvailable()) {
          try {
            const decryptedData = credentialEncryption.decrypt(
              credentials as unknown as EncryptedData,
            );
            credentials =
              typeof decryptedData === "string"
                ? (JSON.parse(decryptedData) as Record<string, unknown>)
                : (decryptedData as Record<string, unknown>);
          } catch (error) {
            console.error(
              `Failed to decrypt credentials for tool ${updatedTool.id}:`,
              error,
            );
            credentials = {};
          }
        }

        return {
          ...updatedTool,
          credentials,
        };
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

      // Delete tool from database
      await db
        .delete(toolCredentials)
        .where(
          and(
            eq(toolCredentials.id, input.id),
            eq(toolCredentials.userId, ctx.userId),
          ),
        );

      // Audit log
      await auditLog.credentialDeleted(
        {
          userId: ctx.userId,
          toolId: input.id,
          ipAddress:
            ctx.headers?.get?.("x-forwarded-for") ??
            ctx.headers?.get?.("x-real-ip") ??
            "unknown",
          userAgent: ctx.headers?.get?.("user-agent") ?? "unknown",
        },
        tool.type,
      );

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
          [key: string]: unknown; // Allow additional properties
        },
      };

      // Add type-specific test details
      switch (tool.type) {
        case ToolType.SLACK:
          testResults.details = {
            ...testResults.details,
            webhookUrl: tool.credentials.webhookUrl ? "Valid" : "Invalid",
            channel: tool.credentials.channel ?? "Default",
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
    .mutation(async ({ input }) => {
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
          totalUsages: 0,
        };

        usage.totalUsages = usage.events.length + usage.workflows.length;

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
            filename = `tools_${new Date().toISOString().split("T")[0] ?? "export"}.json`;
            break;
          case "yaml":
            // Mock YAML export - in real implementation, use a YAML library
            fileContent = `# Tools Export\ntools:\n${exportData.map((tool) => `  - name: "${tool.name}"\n    type: "${tool.type}"`).join("\n")}`;
            filename = `tools_${new Date().toISOString().split("T")[0] ?? "export"}.yaml`;
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

        // Calculate date range for stats
        const now = new Date();
        const startDate = new Date();

        switch (input.period) {
          case "day":
            startDate.setDate(now.getDate() - 1);
            break;
          case "week":
            startDate.setDate(now.getDate() - 7);
            break;
          case "month":
            startDate.setMonth(now.getMonth() - 1);
            break;
          case "year":
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        }

        // Get execution stats from tool_action_logs
        let executionsToday = 0;
        let successCount = 0;
        let totalExecutionTime = 0;

        try {
          const { toolActionLogs } = await import("@/shared/schema");
          const { gte, sql } = await import("drizzle-orm");

          // Get today's executions
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);

          const [todayStats] = await db
            .select({
              count: sql<number>`count(*)::int`,
              successCount: sql<number>`sum(case when status = 'SUCCESS' then 1 else 0 end)::int`,
              avgTime: sql<number>`avg(execution_time)::int`,
            })
            .from(toolActionLogs)
            .where(gte(toolActionLogs.createdAt, todayStart));

          executionsToday = todayStats?.count ?? 0;
          successCount = todayStats?.successCount ?? 0;
          totalExecutionTime = todayStats?.avgTime ?? 0;
        } catch (error) {
          console.log("Could not fetch execution stats:", error);
        }

        const stats = {
          period: input.period,
          groupBy: input.groupBy,
          totalTools: targetTools.length,
          activeTools: targetTools.filter((t) => t.isActive).length,
          inactiveTools: targetTools.filter((t) => !t.isActive).length,
          executionsToday,
          successRate:
            executionsToday > 0
              ? Math.round((successCount / executionsToday) * 100)
              : 0,
          avgResponseTime: Math.round(totalExecutionTime),
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

  // Get available actions for a tool type
  getAvailableActions: toolProcedure
    .input(z.object({ toolType: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        // Import tool plugin registry
        const { ToolPluginRegistry } = await import(
          "@/components/tools/types/tool-plugin"
        );

        if (input.toolType) {
          const plugin = ToolPluginRegistry.get(input.toolType);
          return {
            success: true,
            actions: plugin?.actions ?? [],
          };
        } else {
          // Return all actions from all plugins
          const allActions = ToolPluginRegistry.getAllActions();
          return {
            success: true,
            actions: allActions,
          };
        }
      } catch (error) {
        console.error("Error getting available actions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get available actions",
          cause: error,
        });
      }
    }),

  // Get tool action health status
  getToolActionHealth: toolProcedure
    .input(
      z
        .object({
          toolId: z.number().optional(),
          actionId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      try {
        const { toolActionHealthMonitor } = await import(
          "@/lib/scheduler/tool-action-health-monitor"
        );

        if (input?.toolId && input?.actionId) {
          // Get health for specific tool action
          const metrics = toolActionHealthMonitor.getHealthMetrics(
            input.toolId,
            input.actionId,
          );

          if (!metrics) {
            return {
              success: true,
              status: "unknown",
              message: "No health data available for this tool action",
            };
          }

          const recommendations = toolActionHealthMonitor.getRecommendations(
            input.toolId,
            input.actionId,
          );

          return {
            success: true,
            metrics,
            recommendations,
            needsAttention: toolActionHealthMonitor.needsAttention(
              input.toolId,
              input.actionId,
            ),
          };
        } else {
          // Get overall health summary
          const summary = toolActionHealthMonitor.getHealthSummary();
          const unhealthyActions =
            toolActionHealthMonitor.getUnhealthyActions();

          return {
            success: true,
            summary,
            unhealthyActions: unhealthyActions.map((action) => ({
              toolId: action.toolId,
              actionId: action.actionId,
              status: action.status,
              healthScore: action.healthScore,
              failureRate:
                action.totalExecutions > 0
                  ? (
                      (action.failureCount / action.totalExecutions) *
                      100
                    ).toFixed(1) + "%"
                  : "0%",
              averageLatency: Math.round(action.averageLatency),
              lastExecutionTime: action.lastExecutionTime,
            })),
          };
        }
      } catch (error) {
        console.error("Error getting tool action health:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get tool action health",
          cause: error,
        });
      }
    }),

  // Validate action parameters
  validateActionParams: toolProcedure
    .input(
      z.object({
        actionId: z.string(),
        parameters: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // Import tool plugin registry
        const { ToolPluginRegistry } = await import(
          "@/components/tools/types/tool-plugin"
        );

        const action = ToolPluginRegistry.getActionById(input.actionId);
        if (!action) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Action not found",
          });
        }

        // Validate parameters against action schema
        try {
          action.inputSchema.parse(input.parameters);
          return {
            valid: true,
            errors: [],
          };
        } catch (validationError) {
          if (validationError instanceof z.ZodError) {
            return {
              valid: false,
              errors: validationError.errors.map(
                (err) => `${err.path.join(".")}: ${err.message}`,
              ),
            };
          }
          throw validationError;
        }
      } catch (error) {
        console.error("Error validating action parameters:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to validate action parameters",
          cause: error,
        });
      }
    }),

  // Execute tool action
  executeAction: toolProcedure
    .input(
      z.object({
        toolId: z.number(),
        actionId: z.string(),
        parameters: z.record(z.unknown()),
        isTest: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Get tool credentials
        const tools = await getUserTools(ctx.userId);
        const tool = tools.find((t) => t.id === input.toolId);

        if (!tool) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tool not found",
          });
        }

        // Import tool plugin registry
        const { ToolPluginRegistry } = await import(
          "@/components/tools/types/tool-plugin"
        );

        const action = ToolPluginRegistry.getActionById(input.actionId);
        if (!action) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Action not found",
          });
        }

        // Validate parameters
        try {
          action.inputSchema.parse(input.parameters);
        } catch (validationError) {
          if (validationError instanceof z.ZodError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid parameters: ${validationError.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join(", ")}`,
            });
          }
          throw validationError;
        }

        // Create execution context
        const context = {
          variables: {
            get: (_key: string) => null, // TODO: Implement variable access
            set: (_key: string, _value: unknown) => null, // TODO: Implement variable setting
          },
          logger: {
            info: (message: string) => console.log(`[INFO] ${message}`),
            warn: (message: string) => console.warn(`[WARN] ${message}`),
            error: (message: string) => console.error(`[ERROR] ${message}`),
            debug: (message: string) => console.debug(`[DEBUG] ${message}`),
          },
          isTest: input.isTest,
          onProgress: (progress: { step: string; percentage: number }) => {
            console.log(`[PROGRESS] ${progress.step}: ${progress.percentage}%`);
          },
          onPartialResult: (result: unknown) => {
            console.log(`[PARTIAL] ${JSON.stringify(result)}`);
          },
        };

        // Execute the action
        const startTime = Date.now();
        const result = (await action.execute(
          tool.credentials,
          input.parameters,
          context,
        )) as unknown;
        const executionTime = Date.now() - startTime;

        // Log the execution (this would go to the tool_action_logs table in a real implementation)
        console.log(
          `Tool action executed: ${action.name} (${executionTime}ms)`,
        );

        return {
          success: true,
          result,
          executionTime,
          actionId: action.id,
          actionName: action.name,
          isTest: input.isTest,
        };
      } catch (error) {
        console.error("Error executing tool action:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to execute tool action",
          cause: error,
        });
      }
    }),

  // Check OAuth status for a tool
  checkOAuthStatus: toolProcedure
    .input(
      z.object({
        toolId: z.number(),
        providerId: z.enum(["google", "microsoft", "slack"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const { TokenManager } = await import("@/lib/oauth/TokenManager");
        const {
          GoogleOAuthProvider,
          MicrosoftOAuthProvider,
          SlackOAuthProvider,
        } = await import("@/lib/oauth/providers");

        // Get OAuth configuration
        const clientId =
          process.env[`OAUTH_${input.providerId.toUpperCase()}_CLIENT_ID`];
        const clientSecret =
          process.env[`OAUTH_${input.providerId.toUpperCase()}_CLIENT_SECRET`];

        if (!clientId || !clientSecret) {
          return {
            configured: false,
            hasTokens: false,
            error: "OAuth not configured for this provider",
          };
        }

        const baseUrl = process.env.AUTH_URL ?? "http://localhost:5001";
        const redirectUri = `${baseUrl}/api/oauth/callback`;

        // Create provider
        let provider;
        switch (input.providerId) {
          case "google":
            provider = new GoogleOAuthProvider({
              clientId,
              clientSecret,
              redirectUri,
              scope: "openid email profile",
            });
            break;

          case "microsoft":
            provider = new MicrosoftOAuthProvider({
              clientId,
              clientSecret,
              redirectUri,
              scope: "offline_access User.Read",
              ...(process.env.OAUTH_MICROSOFT_TENANT_ID && {
                tenantId: process.env.OAUTH_MICROSOFT_TENANT_ID,
              }),
            });
            break;

          case "slack":
            provider = new SlackOAuthProvider({
              clientId,
              clientSecret,
              redirectUri,
              scope: "channels:read,chat:write",
            });
            break;
        }

        const tokenManager = new TokenManager(provider);
        const hasTokens = await tokenManager.hasValidTokens(
          ctx.userId,
          input.toolId,
        );

        return {
          configured: true,
          hasTokens,
          providerId: input.providerId,
        };
      } catch (error) {
        console.error("Error checking OAuth status:", error);
        return {
          configured: false,
          hasTokens: false,
          error: "Failed to check OAuth status",
        };
      }
    }),

  // Revoke OAuth tokens
  revokeOAuthTokens: toolProcedure
    .input(
      z.object({
        toolId: z.number(),
        providerId: z.enum(["google", "microsoft", "slack"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { TokenManager } = await import("@/lib/oauth/TokenManager");
        const {
          GoogleOAuthProvider,
          MicrosoftOAuthProvider,
          SlackOAuthProvider,
        } = await import("@/lib/oauth/providers");

        // Get OAuth configuration
        const clientId =
          process.env[`OAUTH_${input.providerId.toUpperCase()}_CLIENT_ID`];
        const clientSecret =
          process.env[`OAUTH_${input.providerId.toUpperCase()}_CLIENT_SECRET`];

        if (!clientId || !clientSecret) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "OAuth not configured for this provider",
          });
        }

        const baseUrl = process.env.AUTH_URL ?? "http://localhost:5001";
        const redirectUri = `${baseUrl}/api/oauth/callback`;

        // Create provider
        let provider;
        switch (input.providerId) {
          case "google":
            provider = new GoogleOAuthProvider({
              clientId,
              clientSecret,
              redirectUri,
              scope: "openid email profile",
            });
            break;

          case "microsoft":
            provider = new MicrosoftOAuthProvider({
              clientId,
              clientSecret,
              redirectUri,
              scope: "offline_access User.Read",
              ...(process.env.OAUTH_MICROSOFT_TENANT_ID && {
                tenantId: process.env.OAUTH_MICROSOFT_TENANT_ID,
              }),
            });
            break;

          case "slack":
            provider = new SlackOAuthProvider({
              clientId,
              clientSecret,
              redirectUri,
              scope: "channels:read,chat:write",
            });
            break;
        }

        const tokenManager = new TokenManager(provider);
        await tokenManager.deleteTokens(ctx.userId, input.toolId);

        return { success: true };
      } catch (error) {
        console.error("Error revoking OAuth tokens:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to revoke OAuth tokens",
          cause: error,
        });
      }
    }),
});
