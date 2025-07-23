import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  normalizePagination,
  createPaginatedResult,
} from "@/server/utils/db-patterns";
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

// Use centralized authentication from trpc.ts

export const serversRouter = createTRPCRouter({
  // Get all servers for user
  getAll: protectedProcedure
    .input(serverQuerySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const pagination = normalizePagination(input);
          const servers = await storage.getAllServers(ctx.session.user.id);

          // Apply filters
          let filteredServers = servers;

          if (input.search) {
            const searchLower = input.search.toLowerCase();
            filteredServers = filteredServers.filter(
              (server) =>
                server.name.toLowerCase().includes(searchLower) ||
                server.address.toLowerCase().includes(searchLower),
            );
          }

          if (input.online !== undefined) {
            filteredServers = filteredServers.filter(
              (server) => server.online === input.online,
            );
          }

          if (input.shared !== undefined) {
            filteredServers = filteredServers.filter(
              (server) => server.shared === input.shared,
            );
          }

          // Apply pagination
          const paginatedServers = filteredServers.slice(
            pagination.offset,
            pagination.offset + pagination.limit,
          );
          const result = createPaginatedResult(
            paginatedServers,
            filteredServers.length,
            pagination,
          );

          // Return in the format the frontend expects
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

        const connectionResult = await sshService.testConnection(
          input.address,
          input.sshKey,
          input.username,
          input.port,
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

        // If SSH key is provided, test the connection
        if (updateData.sshKey) {
          const { sshService } = await import("@/lib/ssh");

          const connectionResult = await sshService.testConnection(
            updateData.address ?? existingServer.address,
            updateData.sshKey,
            updateData.username ?? existingServer.username,
            updateData.port ?? existingServer.port,
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

  // Delete server
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

        await storage.deleteServer(input.id);
        return { success: true };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete server",
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

        const connectionResult = await sshService.testConnection(
          input.address,
          input.sshKey,
          input.username,
          input.port,
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
                await storage.deleteServer(serverId);
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
});
