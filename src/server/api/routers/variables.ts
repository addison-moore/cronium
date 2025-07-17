import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { normalizePagination } from "@/server/utils/db-patterns";
import { type EventType, type EventStatus } from "@/shared/schema";
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

// Use centralized authentication from trpc.ts

export const variablesRouter = createTRPCRouter({
  // Get all user variables
  getAll: protectedProcedure
    .input(variableQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        const variables = await storage.getUserVariables(ctx.session.user.id);
        const pagination = normalizePagination(input);

        // Apply search filter
        let filteredVariables = variables;
        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredVariables = variables.filter(
            (variable) =>
              variable.key.toLowerCase().includes(searchLower) ??
              variable.description?.toLowerCase().includes(searchLower) ??
              variable.value.toLowerCase().includes(searchLower),
          );
        }

        // Apply sorting
        filteredVariables.sort((a, b) => {
          let aValue: string | Date | null;
          let bValue: string | Date | null;

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

          // Handle null values
          if (aValue === null && bValue === null) return 0;
          if (aValue === null) return 1;
          if (bValue === null) return -1;

          if (input.sortOrder === "desc") {
            return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
          } else {
            return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
          }
        });

        // Apply pagination
        const paginatedVariables = filteredVariables.slice(
          pagination.offset,
          pagination.offset + pagination.limit,
        );

        return {
          variables: paginatedVariables,
          total: filteredVariables.length,
          hasMore:
            pagination.offset + pagination.limit < filteredVariables.length,
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
  getById: protectedProcedure
    .input(variableIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const variables = await storage.getUserVariables(ctx.session.user.id);
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
  getByKey: protectedProcedure
    .input(variableKeySchema)
    .query(async ({ ctx, input }) => {
      try {
        const variable = await storage.getUserVariable(
          ctx.session.user.id,
          input.key,
        );

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
  create: protectedProcedure
    .input(createUserVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if variable with this key already exists
        const existingVariable = await storage.getUserVariable(
          ctx.session.user.id,
          input.key,
        );
        if (existingVariable) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A variable with this key already exists",
          });
        }

        const variable = await storage.createUserVariable({
          userId: ctx.session.user.id,
          key: input.key,
          value: input.value,
          description: input.description ?? null,
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
  update: protectedProcedure
    .input(updateUserVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...rawUpdateData } = input;
        // Filter out undefined values for exactOptionalPropertyTypes
        const updateData = Object.fromEntries(
          Object.entries(rawUpdateData).filter(([_, v]) => v !== undefined),
        );

        // Check if variable exists and belongs to user
        const variables = await storage.getUserVariables(ctx.session.user.id);
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
            ctx.session.user.id,
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
          ctx.session.user.id,
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
  delete: protectedProcedure
    .input(variableIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const success = await storage.deleteUserVariable(
          input.id,
          ctx.session.user.id,
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

  // Delete variable by key
  deleteByKey: protectedProcedure
    .input(variableKeySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const success = await storage.deleteUserVariableByKey(
          ctx.session.user.id,
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
  bulkOperation: protectedProcedure
    .input(bulkVariableOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const results = [];
        const userVariables = await storage.getUserVariables(
          ctx.session.user.id,
        );
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
                  ctx.session.user.id,
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
  export: protectedProcedure
    .input(variableExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const userVariables = await storage.getUserVariables(
          ctx.session.user.id,
        );
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
            filename = `variables_${new Date().toISOString().split("T")[0]!}.json`;
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
            filename = `variables_${new Date().toISOString().split("T")[0]!}.env`;
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
                  row.push(`"${(v.description ?? "").replace(/"/g, '""')}"`);
                row.push(
                  v.createdAt?.toISOString() || "",
                  v.updatedAt?.toISOString() || "",
                );
                return row.join(",");
              }),
            ];
            exportData = csvData.join("\n");
            filename = `variables_${new Date().toISOString().split("T")[0]!}.csv`;
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
  validate: protectedProcedure
    .input(validateVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const issues = [];

        // Check if key already exists if checkDuplicates is true
        if (input.checkDuplicates) {
          const existingVariable = await storage.getUserVariable(
            ctx.session.user.id,
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
  getUsage: protectedProcedure
    .input(variableUsageSchema)
    .query(async ({ ctx, input }) => {
      try {
        let variableKey: string;

        if (input.variableId) {
          const variables = await storage.getUserVariables(ctx.session.user.id);
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
          const events = await storage.getAllEvents(ctx.session.user.id);
          const eventsUsingVariable = events.filter(
            (event) =>
              (event.content?.includes(
                `cronium.getVariable("${variableKey}")`,
              ) ??
                false) ||
              (event.content?.includes(
                `cronium.getVariable('${variableKey}')`,
              ) ??
                false) ||
              (event.content?.includes(`$${variableKey}`) ?? false) ||
              (event.content?.includes(`process.env.${variableKey}`) ?? false),
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
          const workflows = await storage.getAllWorkflows(ctx.session.user.id);
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
