import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { type EventType, type EventStatus, UserRole } from "@/shared/schema";
import {
  variableQuerySchema,
  createUserVariableSchema,
  updateUserVariableSchema,
  variableIdSchema,
  variableKeySchema,
  bulkVariableOperationSchema,
  variableExportSchema,
  validateVariableSchema,
  variableUsageSchema,
} from "@shared/schemas/variables";
import { storage } from "@/server/storage";

// Custom procedure that handles auth for tRPC fetch adapter
const variableProcedure = publicProcedure.use(async ({ ctx, next }) => {
  // Try to get session from headers/cookies
  let session = null;
  let userId = null;

  try {
    // If session exists in context, use it
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
    } else {
      // For development, get first admin user
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
    console.error("Auth error in variableProcedure:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

export const variablesRouter = createTRPCRouter({
  // Get all user variables
  getAll: variableProcedure
    .input(variableQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        const variables = await storage.getUserVariables(ctx.userId);

        // Apply search filter
        let filteredVariables = variables;
        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredVariables = variables.filter(
            (variable) =>
              variable.key.toLowerCase().includes(searchLower) ||
              variable.description?.toLowerCase().includes(searchLower) ||
              variable.value.toLowerCase().includes(searchLower),
          );
        }

        // Apply sorting
        filteredVariables.sort((a, b) => {
          let aValue: any, bValue: any;

          switch (input.sortBy) {
            case "key":
              aValue = a.key;
              bValue = b.key;
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
              aValue = a.key;
              bValue = b.key;
          }

          if (input.sortOrder === "desc") {
            return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
          } else {
            return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
          }
        });

        // Apply pagination
        const paginatedVariables = filteredVariables.slice(
          input.offset,
          input.offset + input.limit,
        );

        return {
          variables: paginatedVariables,
          total: filteredVariables.length,
          hasMore: input.offset + input.limit < filteredVariables.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch variables",
          cause: error,
        });
      }
    }),

  // Get single variable by ID
  getById: variableProcedure
    .input(variableIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const variables = await storage.getUserVariables(ctx.userId);
        const variable = variables.find((v) => v.id === input.id);

        if (!variable) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variable not found",
          });
        }

        return variable;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch variable",
          cause: error,
        });
      }
    }),

  // Get variable by key
  getByKey: variableProcedure
    .input(variableKeySchema)
    .query(async ({ ctx, input }) => {
      try {
        const variable = await storage.getUserVariable(ctx.userId, input.key);

        if (!variable) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variable not found",
          });
        }

        return variable;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch variable",
          cause: error,
        });
      }
    }),

  // Create new variable
  create: variableProcedure
    .input(createUserVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if variable with this key already exists
        const existingVariable = await storage.getUserVariable(
          ctx.userId,
          input.key,
        );
        if (existingVariable) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A variable with this key already exists",
          });
        }

        const variable = await storage.createUserVariable({
          userId: ctx.userId,
          key: input.key,
          value: input.value,
          description: input.description || null,
        });

        return variable;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create variable",
          cause: error,
        });
      }
    }),

  // Update existing variable
  update: variableProcedure
    .input(updateUserVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...rawUpdateData } = input;
        // Filter out undefined values for exactOptionalPropertyTypes
        const updateData = Object.fromEntries(
          Object.entries(rawUpdateData).filter(([_, v]) => v !== undefined),
        );

        // Check if variable exists and belongs to user
        const variables = await storage.getUserVariables(ctx.userId);
        const existingVariable = variables.find((v) => v.id === id);

        if (!existingVariable) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variable not found",
          });
        }

        // Check for key conflicts if key is being updated
        if (updateData.key && updateData.key !== existingVariable.key) {
          const conflictingVariable = await storage.getUserVariable(
            ctx.userId,
            updateData.key,
          );
          if (conflictingVariable) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A variable with this key already exists",
            });
          }
        }

        const updatedVariable = await storage.updateUserVariable(
          id,
          ctx.userId,
          updateData,
        );
        if (!updatedVariable) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variable not found",
          });
        }

        return updatedVariable;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update variable",
          cause: error,
        });
      }
    }),

  // Delete variable
  delete: variableProcedure
    .input(variableIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const success = await storage.deleteUserVariable(input.id, ctx.userId);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variable not found",
          });
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete variable",
          cause: error,
        });
      }
    }),

  // Delete variable by key
  deleteByKey: variableProcedure
    .input(variableKeySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const success = await storage.deleteUserVariableByKey(
          ctx.userId,
          input.key,
        );
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variable not found",
          });
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete variable",
          cause: error,
        });
      }
    }),

  // Bulk operations on variables
  bulkOperation: variableProcedure
    .input(bulkVariableOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const results = [];
        const userVariables = await storage.getUserVariables(ctx.userId);
        const userVariableIds = userVariables.map((v) => v.id);

        for (const variableId of input.variableIds) {
          try {
            // Check if variable belongs to user
            if (!userVariableIds.includes(variableId)) {
              results.push({
                id: variableId,
                success: false,
                error: "Variable not found",
              });
              continue;
            }

            switch (input.operation) {
              case "delete":
                const success = await storage.deleteUserVariable(
                  variableId,
                  ctx.userId,
                );
                if (!success) {
                  results.push({
                    id: variableId,
                    success: false,
                    error: "Failed to delete",
                  });
                } else {
                  results.push({ id: variableId, success: true });
                }
                break;
              case "export":
                // For export, we just mark as successful - actual export data is handled separately
                results.push({ id: variableId, success: true });
                break;
            }
          } catch (error) {
            results.push({
              id: variableId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return { results };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
          cause: error,
        });
      }
    }),

  // Export variables
  export: variableProcedure
    .input(variableExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const userVariables = await storage.getUserVariables(ctx.userId);
        const variablesToExport = userVariables.filter((v) =>
          input.variableIds.includes(v.id),
        );

        if (variablesToExport.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No variables found to export",
          });
        }

        let exportData: string;
        let filename: string;

        switch (input.format) {
          case "json":
            const jsonData = variablesToExport.map((v) => ({
              key: v.key,
              value: input.includeValues ? v.value : "[HIDDEN]",
              description: input.includeDescriptions
                ? v.description
                : undefined,
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
            }));
            exportData = JSON.stringify(jsonData, null, 2);
            filename = `variables_${new Date().toISOString().split("T")[0]}.json`;
            break;

          case "env":
            exportData = variablesToExport
              .map((v) => {
                const comment =
                  input.includeDescriptions && v.description
                    ? `# ${v.description}\n`
                    : "";
                const value = input.includeValues ? v.value : "[HIDDEN]";
                return `${comment}${v.key}=${value}`;
              })
              .join("\n\n");
            filename = `variables_${new Date().toISOString().split("T")[0]}.env`;
            break;

          case "csv":
            const headers = ["Key"];
            if (input.includeValues) headers.push("Value");
            if (input.includeDescriptions) headers.push("Description");
            headers.push("Created At", "Updated At");

            const csvData = [
              headers.join(","),
              ...variablesToExport.map((v) => {
                const row = [v.key];
                if (input.includeValues)
                  row.push(`"${v.value.replace(/"/g, '""')}"`);
                if (input.includeDescriptions)
                  row.push(`"${(v.description || "").replace(/"/g, '""')}"`);
                row.push(
                  v.createdAt?.toISOString() || "",
                  v.updatedAt?.toISOString() || "",
                );
                return row.join(",");
              }),
            ];
            exportData = csvData.join("\n");
            filename = `variables_${new Date().toISOString().split("T")[0]}.csv`;
            break;

          default:
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid export format",
            });
        }

        return {
          data: exportData,
          filename,
          format: input.format,
          count: variablesToExport.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to export variables",
          cause: error,
        });
      }
    }),

  // Validate variable (check key format and duplicates)
  validate: variableProcedure
    .input(validateVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const issues = [];

        // Check if key already exists if checkDuplicates is true
        if (input.checkDuplicates) {
          const existingVariable = await storage.getUserVariable(
            ctx.userId,
            input.key,
          );
          if (existingVariable) {
            issues.push({
              type: "duplicate_key",
              message: "A variable with this key already exists",
            });
          }
        }

        // Check for reserved prefixes
        const reservedPrefixes = [
          "CRONIUM_",
          "SYSTEM_",
          "NODE_",
          "PATH",
          "HOME",
        ];
        if (reservedPrefixes.some((prefix) => input.key.startsWith(prefix))) {
          issues.push({
            type: "reserved_prefix",
            message: "Variable key uses a reserved prefix",
          });
        }

        // Check value length
        if (input.value.length > 10000) {
          issues.push({
            type: "value_too_long",
            message:
              "Variable value exceeds maximum length of 10,000 characters",
          });
        }

        return {
          valid: issues.length === 0,
          issues,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to validate variable",
          cause: error,
        });
      }
    }),

  // Get variable usage in events and workflows
  getUsage: variableProcedure
    .input(variableUsageSchema)
    .query(async ({ ctx, input }) => {
      try {
        let variableKey: string;

        if (input.variableId) {
          const variables = await storage.getUserVariables(ctx.userId);
          const variable = variables.find((v) => v.id === input.variableId);
          if (!variable) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Variable not found",
            });
          }
          variableKey = variable.key;
        } else if (input.key) {
          variableKey = input.key;
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Either variableId or key must be provided",
          });
        }

        const usage = {
          events: [] as {
            id: number;
            name: string;
            type: EventType;
            status: EventStatus;
          }[],
          workflows: [] as { id: number; name: string; status: string }[],
          totalUsages: 0,
        };

        // Search for variable usage in events
        if (input.includeEvents) {
          const events = await storage.getAllEvents(ctx.userId);
          const eventsUsingVariable = events.filter(
            (event) =>
              event.content?.includes(
                `cronium.getVariable("${variableKey}")`,
              ) ||
              event.content?.includes(
                `cronium.getVariable('${variableKey}')`,
              ) ||
              event.content?.includes(`$${variableKey}`) ||
              event.content?.includes(`process.env.${variableKey}`),
          );

          usage.events = eventsUsingVariable.map((event) => ({
            id: event.id,
            name: event.name,
            type: event.type,
            status: event.status,
          }));
        }

        // Search for variable usage in workflows
        if (input.includeWorkflows) {
          const workflows = await storage.getAllWorkflows(ctx.userId);
          // Note: This is a simplified check. In a real implementation,
          // you'd need to search through workflow node configurations
          usage.workflows = workflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
            status: workflow.status,
          }));
        }

        usage.totalUsages = usage.events.length + usage.workflows.length;

        return usage;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get variable usage",
          cause: error,
        });
      }
    }),
});
