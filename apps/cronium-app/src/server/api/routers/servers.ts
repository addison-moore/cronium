import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { normalizePagination } from "@/server/utils/db-patterns";
import { withErrorHandling } from "@/server/utils/error-utils";
import {
  serverQuerySchema,
  createServerSchema,
  updateServerSchema,
  serverIdSchema,
  serverHealthCheckSchema,
  serverEventsSchema,
  bulkServerOperationSchema,
  testServerConnectionSchema,
  serverUsageStatsSchema,
  serverLogsSchema,
} from "@shared/schemas/servers";
import { type InsertServer } from "@shared/schema";
import { storage } from "@/server/storage";
import { type Log } from "@shared/schema";

/**
 * NOTE: Several methods in this router use direct database queries instead of
 * storage module methods due to a TypeScript/Webpack transpilation issue where
 * certain storage methods (getServerDeletionImpact, archiveServer, restoreServer,
 * permanentlyDeleteServer, getArchivedServers, etc.) are not recognized at runtime.
 *
 * This is a known issue that should be investigated further, but the direct
 * implementations work correctly as workarounds.
 */

// Use centralized authentication from trpc.ts

export const serversRouter = createTRPCRouter({
  // Get all servers for user
  getAll: protectedProcedure
    .input(serverQuerySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const result = await storage.queryServers(ctx.session.user.id, input);

          return {
            servers: result.items,
            total: result.total,
            hasMore: result.hasMore,
          };
        },
        {
          component: "serversRouter",
          operationName: "getAll",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get single server by ID
  getById: protectedProcedure
    .input(serverIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }

        // Check if user can access this server
        const canAccess = await storage.canUserAccessServer(
          input.id,
          ctx.session.user.id,
        );
        if (!canAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        return server;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch server",
          cause: error,
        });
      }
    }),

  // Create new server
  create: protectedProcedure
    .input(createServerSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Test SSH connection before creating
        const { sshService } = await import("@/lib/ssh");

        console.log(
          `Testing SSH connection to ${input.address}:${input.port} as ${input.username}`,
        );

        // Determine auth type based on provided credentials
        const authCredential = input.sshKey ?? input.password ?? "";
        const authType = input.sshKey ? "privateKey" : "password";

        const connectionResult = await sshService.testConnection(
          input.address,
          authCredential,
          input.username,
          input.port,
          authType,
        );

        if (!connectionResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `SSH connection failed: ${connectionResult.message}`,
          });
        }

        // Create the server
        const server = await storage.createServer({
          ...input,
          userId: ctx.session.user.id,
        });

        return server;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;

        // Handle SSH connection errors
        if (
          typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string" &&
          error.message.includes("SSH")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "SSH connection failed - please verify your connection details",
            cause: error,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create server",
          cause: error,
        });
      }
    }),

  // Update existing server
  update: protectedProcedure
    .input(updateServerSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...updateData } = input;

        // Check if user owns the server
        const existingServer = await storage.getServer(id);
        if (!existingServer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (existingServer.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to edit this server",
          });
        }

        // If SSH key or password is provided, test the connection
        if (updateData.sshKey || updateData.password) {
          const { sshService } = await import("@/lib/ssh");

          // Determine auth type and credential
          const authCredential = updateData.sshKey ?? updateData.password ?? "";
          const authType = updateData.sshKey ? "privateKey" : "password";

          const connectionResult = await sshService.testConnection(
            updateData.address ?? existingServer.address,
            authCredential,
            updateData.username ?? existingServer.username,
            updateData.port ?? existingServer.port,
            authType,
          );

          if (!connectionResult.success) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `SSH connection failed: ${connectionResult.message}`,
            });
          }
        }

        // Filter out undefined values before passing to updateServer
        const filteredUpdateData = Object.fromEntries(
          Object.entries(updateData).filter(
            ([_, value]) => value !== undefined,
          ),
        ) as Partial<InsertServer>;

        const updatedServer = await storage.updateServer(
          id,
          filteredUpdateData,
        );
        return updatedServer;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update server",
          cause: error,
        });
      }
    }),

  // Get server deletion impact analysis
  getDeletionImpact: protectedProcedure
    .input(serverIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Check if user owns the server
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (server.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to analyze this server",
          });
        }

        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { events, eventServers, executions, EventStatus } = await import(
          "@shared/schema"
        );
        const { eq, and } = await import("drizzle-orm");

        // Get counts of affected resources
        const affectedEvents = await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.serverId, input.id));

        const affectedEventServers = await db
          .select({ id: eventServers.eventId })
          .from(eventServers)
          .where(eq(eventServers.serverId, input.id));

        const affectedExecutions = await db
          .select({ id: executions.id })
          .from(executions)
          .where(eq(executions.serverId, input.id));

        // Get active events that would be affected
        const activeEvents = await db
          .select({
            id: events.id,
            name: events.name,
            status: events.status,
          })
          .from(events)
          .where(
            and(
              eq(events.serverId, input.id),
              eq(events.status, EventStatus.ACTIVE),
            ),
          )
          .limit(10);

        const impact = {
          eventCount: affectedEvents.length,
          eventServerCount: affectedEventServers.length,
          executionCount: affectedExecutions.length,
          activeEvents,
        };

        return {
          ...impact,
          serverName: server.name,
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;

        console.error("Server deletion impact error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to analyze server deletion impact",
          cause: error,
        });
      }
    }),

  // Archive server (soft delete)
  archive: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the server
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (server.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to archive this server",
          });
        }

        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { servers } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");

        // Archive the server with sensitive data purging
        const [archivedServer] = await db
          .update(servers)
          .set({
            isArchived: true,
            archivedAt: new Date(),
            archivedBy: ctx.session.user.id,
            archiveReason: input.reason,
            sshKey: null, // Immediately purge sensitive data
            password: null,
            sshKeyPurged: true,
            passwordPurged: true,
            deletionScheduledAt: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ), // 30 days from now
            updatedAt: new Date(),
          })
          .where(eq(servers.id, input.id))
          .returning();

        if (!archivedServer) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to archive server",
          });
        }

        return {
          success: true,
          server: archivedServer,
          message:
            "Server archived successfully. Sensitive data has been purged.",
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;

        console.error("Server archive error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to archive server",
          cause: error,
        });
      }
    }),

  // Restore archived server
  restore: protectedProcedure
    .input(serverIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the server
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (server.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to restore this server",
          });
        }

        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { servers } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");

        const [restoredServer] = await db
          .update(servers)
          .set({
            isArchived: false,
            archivedAt: null,
            archivedBy: null,
            archiveReason: null,
            deletionScheduledAt: null,
            updatedAt: new Date(),
          })
          .where(eq(servers.id, input.id))
          .returning();

        if (!restoredServer) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to restore server",
          });
        }

        return {
          success: true,
          server: restoredServer,
          requiresCredentials:
            restoredServer.sshKeyPurged || restoredServer.passwordPurged,
          message:
            restoredServer.sshKeyPurged || restoredServer.passwordPurged
              ? "Server restored. Please reconfigure credentials as they were purged during archival."
              : "Server restored successfully.",
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Check for specific restore errors
        if (errorMessage.includes("sensitive credentials have been purged")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        console.error("Server restore error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to restore server",
          cause: error,
        });
      }
    }),

  // Get archived servers
  getArchived: protectedProcedure.query(async ({ ctx }) => {
    try {
      // Using direct database query (see workaround note at top of file)
      const { db } = await import("@/server/db");
      const { servers } = await import("@shared/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const archivedServers = await db
        .select()
        .from(servers)
        .where(
          and(
            eq(servers.userId, ctx.session.user.id),
            eq(servers.isArchived, true),
          ),
        )
        .orderBy(desc(servers.archivedAt));

      return {
        servers: archivedServers,
        total: archivedServers.length,
      };
    } catch (error: unknown) {
      if (error instanceof TRPCError) throw error;

      console.error("Get archived servers error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch archived servers",
        cause: error,
      });
    }
  }),

  // Permanently delete archived server
  permanentDelete: protectedProcedure
    .input(serverIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the server
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (server.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this server",
          });
        }
        if (!server.isArchived) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Server must be archived before permanent deletion",
          });
        }

        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { servers, eventServers, events, executions, RunLocation } =
          await import("@shared/schema");
        const { eq } = await import("drizzle-orm");

        // Use the deleteServer logic directly (permanent deletion)
        // Use a transaction to ensure all operations complete or none do
        await db.transaction(async (tx) => {
          // 1. Delete event-server relationships FIRST
          await tx
            .delete(eventServers)
            .where(eq(eventServers.serverId, input.id));

          // 2. Update events that use this server to use local execution
          await tx
            .update(events)
            .set({
              serverId: null,
              runLocation: RunLocation.LOCAL,
              updatedAt: new Date(),
            })
            .where(eq(events.serverId, input.id));

          // 3. Update executions to remove server reference (keep for audit)
          await tx
            .update(executions)
            .set({
              serverId: null,
            })
            .where(eq(executions.serverId, input.id));

          // 4. Finally delete the server
          await tx.delete(servers).where(eq(servers.id, input.id));
        });

        return {
          success: true,
          message: "Server permanently deleted",
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;

        console.error("Server permanent deletion error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to permanently delete server",
          cause: error,
        });
      }
    }),

  // Delete server (deprecated - will archive instead)
  delete: protectedProcedure
    .input(serverIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the server
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (server.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this server",
          });
        }

        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { servers, eventServers, events, executions, RunLocation } =
          await import("@shared/schema");
        const { eq } = await import("drizzle-orm");

        // Use a transaction to ensure all operations complete or none do
        await db.transaction(async (tx) => {
          // 1. Delete event-server relationships FIRST
          await tx
            .delete(eventServers)
            .where(eq(eventServers.serverId, input.id));

          // 2. Update events that use this server to use local execution
          await tx
            .update(events)
            .set({
              serverId: null,
              runLocation: RunLocation.LOCAL,
              updatedAt: new Date(),
            })
            .where(eq(events.serverId, input.id));

          // 3. Update executions to remove server reference (keep for audit)
          await tx
            .update(executions)
            .set({
              serverId: null,
            })
            .where(eq(executions.serverId, input.id));

          // 4. Finally delete the server
          await tx.delete(servers).where(eq(servers.id, input.id));
        });

        return { success: true };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;

        // Log the actual error for debugging
        console.error("Server deletion error:", error);

        // Check for specific database constraint errors
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Provide more specific error messages based on the error
        if (
          errorMessage.includes("foreign key") ||
          errorMessage.includes("constraint")
        ) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Cannot delete server: It is still referenced by other data. Please remove all associated events and executions first.",
            cause: error,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete server: ${errorMessage}`,
          cause: error,
        });
      }
    }),

  // Check server health/status
  checkHealth: protectedProcedure
    .input(serverHealthCheckSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the server
        const server = await storage.getServer(input.id);
        if (!server) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
        if (server.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to check this server",
          });
        }

        // Perform health check
        const { sshService } = await import("@/lib/ssh");

        console.log(
          `Checking health for server: ${server.name} at ${server.address}:${server.port}`,
        );

        const healthCheck = await sshService.checkServerHealth(server);

        // Update server status in database
        const lastChecked = new Date();
        await storage.updateServerStatus(
          input.id,
          healthCheck.online,
          lastChecked,
        );

        return {
          online: healthCheck.online,
          systemInfo: healthCheck.systemInfo,
          error: healthCheck.error,
          lastChecked: lastChecked.toISOString(),
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check server health",
          cause: error,
        });
      }
    }),

  // Test server connection (without saving)
  testConnection: protectedProcedure
    .input(testServerConnectionSchema)
    .mutation(async ({ input }) => {
      try {
        const { sshService } = await import("@/lib/ssh");

        console.log(
          `Testing connection to ${input.address}:${input.port} as ${input.username}`,
        );

        // Determine auth type and credential
        const authCredential = input.sshKey ?? input.password ?? "";
        const authType = input.sshKey ? "privateKey" : "password";

        const connectionResult = await sshService.testConnection(
          input.address,
          authCredential,
          input.username,
          input.port,
          authType,
        );

        return {
          success: connectionResult.success,
          message: connectionResult.message,
          details: connectionResult.success
            ? `Successfully connected to ${input.address}`
            : `Failed to connect to ${input.address}`,
        };
      } catch (error: unknown) {
        console.error("Connection test error:", error);
        return {
          success: false,
          message:
            typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
              ? error.message
              : "Connection test failed",
          details: "Please verify your server details and SSH key format",
        };
      }
    }),

  // Get events associated with a server
  getEvents: protectedProcedure
    .input(serverEventsSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Check if user can access the server
        const canAccess = await storage.canUserAccessServer(
          input.id,
          ctx.session.user.id,
        );
        if (!canAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Get events for this server using existing method
        const events = await storage.getEventsByServerId(
          input.id,
          ctx.session.user.id,
        );

        // Apply filters
        let filteredEvents = events;
        if (input.status) {
          filteredEvents = events.filter(
            (event) => event.status === input.status,
          );
        }

        // Apply pagination
        const pagination = normalizePagination(input);
        const paginatedEvents = filteredEvents.slice(
          pagination.offset,
          pagination.offset + pagination.limit,
        );

        return {
          events: paginatedEvents,
          total: filteredEvents.length,
          hasMore: pagination.offset + pagination.limit < filteredEvents.length,
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch server events",
          cause: error,
        });
      }
    }),

  // Bulk operations on servers
  bulkOperation: protectedProcedure
    .input(bulkServerOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const results = [];

        for (const serverId of input.serverIds) {
          try {
            // Check if user owns the server
            const server = await storage.getServer(serverId);
            if (!server || server.userId !== ctx.session.user.id) {
              results.push({
                id: serverId,
                success: false,
                error: "Access denied",
              });
              continue;
            }

            switch (input.operation) {
              case "delete":
                // Using direct database query (see workaround note at top of file)
                const { db } = await import("@/server/db");
                const {
                  servers,
                  eventServers,
                  events,
                  executions,
                  RunLocation,
                } = await import("@shared/schema");
                const { eq } = await import("drizzle-orm");

                await db.transaction(async (tx) => {
                  await tx
                    .delete(eventServers)
                    .where(eq(eventServers.serverId, serverId));
                  await tx
                    .update(events)
                    .set({
                      serverId: null,
                      runLocation: RunLocation.LOCAL,
                      updatedAt: new Date(),
                    })
                    .where(eq(events.serverId, serverId));
                  await tx
                    .update(executions)
                    .set({
                      serverId: null,
                    })
                    .where(eq(executions.serverId, serverId));
                  await tx.delete(servers).where(eq(servers.id, serverId));
                });
                break;
              case "check_health":
                const { sshService } = await import("@/lib/ssh");
                const healthCheck = await sshService.checkServerHealth(server);
                await storage.updateServerStatus(
                  serverId,
                  healthCheck.online,
                  new Date(),
                );
                break;
              case "share":
                await storage.updateServer(serverId, { shared: true });
                break;
              case "unshare":
                await storage.updateServer(serverId, { shared: false });
                break;
            }

            results.push({ id: serverId, success: true });
          } catch (error: unknown) {
            results.push({
              id: serverId,
              success: false,
              error:
                typeof error === "object" &&
                error !== null &&
                "message" in error &&
                typeof error.message === "string"
                  ? error.message
                  : "Unknown error",
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

  // Get server usage statistics
  getUsageStats: protectedProcedure
    .input(serverUsageStatsSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Check if user can access the server
        const canAccess = await storage.canUserAccessServer(
          input.id,
          ctx.session.user.id,
        );
        if (!canAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // TODO: Implement usage statistics retrieval
        return {
          serverId: input.id,
          period: input.period,
          totalJobs: 0,
          successfulJobs: 0,
          failedJobs: 0,
          averageExecutionTime: 0,
          cpuUsage: [],
          memoryUsage: [],
          diskUsage: [],
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch server usage statistics",
          cause: error,
        });
      }
    }),

  // Get server logs
  getLogs: protectedProcedure
    .input(serverLogsSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Check if user can access the server
        const canAccess = await storage.canUserAccessServer(
          input.id,
          ctx.session.user.id,
        );
        if (!canAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // TODO: Implement server log retrieval
        const logs: Log[] = [];

        return {
          logs,
          total: logs.length,
          hasMore: false,
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch server logs",
          cause: error,
        });
      }
    }),

  // Get upcoming server deletions for the current user
  getUpcomingDeletions: protectedProcedure
    .input(z.object({ daysAhead: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      try {
        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { servers } = await import("@shared/schema");
        const { eq, and, lte, gte, isNotNull } = await import("drizzle-orm");

        const now = new Date();
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + input.daysAhead);

        const archivedServers = await db
          .select()
          .from(servers)
          .where(
            and(
              eq(servers.userId, ctx.session.user.id),
              eq(servers.isArchived, true),
              isNotNull(servers.deletionScheduledAt),
              gte(servers.deletionScheduledAt, now),
              lte(servers.deletionScheduledAt, targetDate),
            ),
          );

        return archivedServers;
      } catch (error) {
        console.error("Error fetching upcoming deletions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch upcoming deletions",
          cause: error,
        });
      }
    }),

  // Get user's deletion notifications
  getNotifications: protectedProcedure
    .input(z.object({ unacknowledgedOnly: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      try {
        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { serverDeletionNotifications } = await import("@shared/schema");
        const { eq, and, desc } = await import("drizzle-orm");

        const conditions = [
          eq(serverDeletionNotifications.userId, ctx.session.user.id),
        ];

        if (input.unacknowledgedOnly) {
          conditions.push(eq(serverDeletionNotifications.acknowledged, false));
        }

        return await db
          .select()
          .from(serverDeletionNotifications)
          .where(and(...conditions))
          .orderBy(desc(serverDeletionNotifications.sentAt));
      } catch (error) {
        console.error("Error fetching notifications:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch notifications",
          cause: error,
        });
      }
    }),

  // Acknowledge a deletion notification
  acknowledgeNotification: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Using direct database query (see workaround note at top of file)
        const { db } = await import("@/server/db");
        const { serverDeletionNotifications } = await import("@shared/schema");
        const { eq, and } = await import("drizzle-orm");

        await db
          .update(serverDeletionNotifications)
          .set({
            acknowledged: true,
            acknowledgedAt: new Date(),
          })
          .where(
            and(
              eq(serverDeletionNotifications.id, input.notificationId),
              eq(serverDeletionNotifications.userId, ctx.session.user.id),
            ),
          );

        return { success: true };
      } catch (error) {
        console.error("Error acknowledging notification:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to acknowledge notification",
          cause: error,
        });
      }
    }),
});
