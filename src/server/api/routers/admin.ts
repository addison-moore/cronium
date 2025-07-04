import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  adminQuerySchema,
  inviteUserSchema,
  updateUserSchema,
  userIdSchema,
  toggleUserStatusSchema,
  bulkUserOperationSchema,
  createVariableSchema,
  updateVariableSchema,
  variableIdSchema,
  variableQuerySchema,
  systemSettingsSchema,
  adminLogsSchema,
  logIdSchema,
  systemStatsSchema,
} from "@shared/schemas/admin";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@shared/schema";

// Define Log interface for proper typing
interface Log {
  id: string;
  timestamp: Date;
  level: "ERROR" | "WARN" | "INFO" | "DEBUG";
  message: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

// Admin-only procedure middleware
const adminProcedure = publicProcedure.use(async ({ ctx, next }) => {
  let session = null;
  let userId = null;
  let userRole = null;

  try {
    // If session exists in context, use it
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
      userRole = ctx.session.user.role;
    } else {
      // For development, get first admin user
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter((user) => user.role === "ADMIN");
        const firstAdmin = adminUsers[0];
        if (firstAdmin) {
          userId = firstAdmin.id;
          userRole = firstAdmin.role;
          session = { user: { id: firstAdmin.id, role: firstAdmin.role } };
        }
      }
    }

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    if (userRole !== UserRole.ADMIN) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin access required",
      });
    }

    return next({
      ctx: {
        ...ctx,
        session,
        userId,
        userRole,
      },
    });
  } catch (error) {
    console.error("Auth error in adminProcedure:", error);
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

export const adminRouter = createTRPCRouter({
  // User Management
  // Get all users
  getUsers: adminProcedure
    .input(adminQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        const users = await storage.getAllUsers();

        // Apply filters
        let filteredUsers = users;

        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredUsers = filteredUsers.filter(
            (user) =>
              (user.email?.toLowerCase() || "").includes(searchLower) ||
              (user.firstName?.toLowerCase() || "").includes(searchLower) ||
              (user.lastName?.toLowerCase() || "").includes(searchLower),
          );
        }

        if (input.role) {
          filteredUsers = filteredUsers.filter(
            (user) => user.role === input.role,
          );
        }

        if (input.status) {
          filteredUsers = filteredUsers.filter(
            (user) => user.status === input.status,
          );
        }

        // Apply pagination
        const paginatedUsers = filteredUsers.slice(
          input.offset,
          input.offset + input.limit,
        );

        return {
          users: paginatedUsers,
          total: filteredUsers.length,
          hasMore: input.offset + input.limit < filteredUsers.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch users",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get single user by ID
  getUser: adminProcedure.input(userIdSchema).query(async ({ ctx, input }) => {
    try {
      const user = await storage.getUser(input.id);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      return user;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch user",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Invite new user
  inviteUser: adminProcedure
    .input(inviteUserSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user with this email already exists
        const existingUser = await storage.getUserByEmail(input.email);
        if (existingUser) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A user with this email already exists",
          });
        }

        // Generate invite token and expiry
        const crypto = await import("crypto");
        const { nanoid } = await import("nanoid");

        const userId = crypto.randomUUID();
        const inviteToken = nanoid(32);
        const inviteExpiry = new Date();
        inviteExpiry.setHours(inviteExpiry.getHours() + 48);

        // Create the new user with invited status
        const newUser = await storage.createUser({
          id: userId,
          email: input.email,
          role: input.role,
          status: UserStatus.INVITED,
          inviteToken,
          inviteExpiry,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // TODO: Send invitation email
        console.log(
          `Invitation created for ${input.email} with token ${inviteToken}`,
        );

        return newUser;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to invite user",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Update user
  updateUser: adminProcedure
    .input(updateUserSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...updateData } = input;

        const existingUser = await storage.getUser(id);
        if (!existingUser) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }

        const updatedUser = await storage.updateUser(id, {
          ...updateData,
          updatedAt: new Date(),
        });

        return updatedUser;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update user",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Toggle user status (enable/disable)
  toggleUserStatus: adminProcedure
    .input(toggleUserStatusSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const existingUser = await storage.getUser(input.id);
        if (!existingUser) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }

        // Prevent admin from disabling themselves
        if (input.id === ctx.userId && input.status !== UserStatus.ACTIVE) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot disable your own account",
          });
        }

        const updatedUser = await storage.updateUser(input.id, {
          status: input.status,
          updatedAt: new Date(),
        });

        return updatedUser;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update user status",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Bulk user operations
  bulkUserOperation: adminProcedure
    .input(bulkUserOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const results = [];

        for (const userId of input.userIds) {
          try {
            // Prevent admin from operating on themselves for certain operations
            if (
              userId === ctx.userId &&
              ["delete", "deactivate"].includes(input.operation)
            ) {
              results.push({
                id: userId,
                success: false,
                error: "Cannot perform this operation on your own account",
              });
              continue;
            }

            const user = await storage.getUser(userId);
            if (!user) {
              results.push({
                id: userId,
                success: false,
                error: "User not found",
              });
              continue;
            }

            switch (input.operation) {
              case "activate":
                await storage.updateUser(userId, {
                  status: UserStatus.ACTIVE,
                  updatedAt: new Date(),
                });
                break;
              case "deactivate":
                await storage.updateUser(userId, {
                  status: UserStatus.DISABLED,
                  updatedAt: new Date(),
                });
                break;
              case "delete":
                await storage.deleteUser(userId);
                break;
              case "resend_invite":
                if (user.status === UserStatus.INVITED) {
                  // TODO: Resend invitation email
                  console.log(`Resending invitation to ${user.email}`);
                } else {
                  results.push({
                    id: userId,
                    success: false,
                    error: "User is not in invited status",
                  });
                  continue;
                }
                break;
            }

            results.push({ id: userId, success: true });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            results.push({ id: userId, success: false, error: errorMessage });
          }
        }

        return { results };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Variable Management
  // Get all variables (using user variables for now)
  getVariables: adminProcedure
    .input(variableQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        // For now, use user variables. In the future, implement global variables
        const targetUserId = input.userId || ctx.userId;
        const variables = await storage.getUserVariables(targetUserId);

        // Apply filters
        let filteredVariables = variables;

        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredVariables = filteredVariables.filter(
            (variable) =>
              variable.key.toLowerCase().includes(searchLower) ||
              variable.description?.toLowerCase().includes(searchLower),
          );
        }

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
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Create variable (using user variables for now)
  createVariable: adminProcedure
    .input(createVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if variable with this key already exists for this user
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
          description: input.description,
        });

        return variable;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create variable",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Update variable (using user variables for now)
  updateVariable: adminProcedure
    .input(updateVariableSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...rawUpdateData } = input;

        // Filter out undefined values to satisfy exactOptionalPropertyTypes
        const updateData = Object.fromEntries(
          Object.entries(rawUpdateData).filter(
            ([, value]) => value !== undefined,
          ),
        );

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
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Delete variable (using user variables for now)
  deleteVariable: adminProcedure
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
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // System Management
  // Get system settings
  getSystemSettings: adminProcedure.query(async ({ ctx }) => {
    try {
      // Get all settings from database
      const settings = await storage.getAllSettings();

      // Transform settings array to an object for easier consumption by the client
      const settingsObject = settings.reduce(
        (acc, setting) => {
          // Try to parse the value as JSON, if it fails just use the string
          try {
            acc[setting.key] = JSON.parse(setting.value);
          } catch (e) {
            acc[setting.key] = setting.value;
          }
          return acc;
        },
        {} as Record<string, any>,
      );

      // Return settings with default values for any missing keys
      return {
        // Basic system settings
        maxUsers: settingsObject.maxUsers ?? 100,
        maxEventsPerUser: settingsObject.maxEventsPerUser ?? 1000,
        maxWorkflowsPerUser: settingsObject.maxWorkflowsPerUser ?? 100,
        maxServersPerUser: settingsObject.maxServersPerUser ?? 10,
        enableRegistration: settingsObject.enableRegistration ?? false,
        enableGuestAccess: settingsObject.enableGuestAccess ?? false,
        defaultUserRole: settingsObject.defaultUserRole ?? UserRole.USER,
        sessionTimeout: settingsObject.sessionTimeout ?? 3600,
        logRetentionDays: settingsObject.logRetentionDays ?? 30,

        // SMTP settings
        smtpHost: settingsObject.smtpHost ?? "",
        smtpPort: settingsObject.smtpPort ?? "587",
        smtpUser: settingsObject.smtpUser ?? "",
        smtpPassword: settingsObject.smtpPassword ?? "",
        smtpFromEmail: settingsObject.smtpFromEmail ?? "",
        smtpFromName: settingsObject.smtpFromName ?? "Cronium",
        smtpEnabled: settingsObject.smtpEnabled ?? false,

        // Registration settings
        allowRegistration: settingsObject.allowRegistration ?? false,
        requireAdminApproval: settingsObject.requireAdminApproval ?? true,
        inviteOnly: settingsObject.inviteOnly ?? true,

        // AI settings
        aiEnabled: settingsObject.aiEnabled ?? false,
        aiModel: settingsObject.aiModel ?? "gpt-3.5-turbo",
        openaiApiKey: settingsObject.openaiApiKey ?? "",
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch system settings",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Update system settings
  updateSystemSettings: adminProcedure
    .input(systemSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Update each setting in the database
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined && value !== null) {
            // Convert the value to string for storage, handling different types
            const stringValue =
              typeof value === "string" ? value : JSON.stringify(value);
            await storage.upsertSetting(key, stringValue);
          }
        }

        return { success: true, settings: input };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update system settings",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get system statistics
  getSystemStats: adminProcedure
    .input(systemStatsSchema)
    .query(async ({ ctx, input }) => {
      try {
        const allUsers = await storage.getAllUsers();

        // For now, get events from the first admin user to approximate total events
        const adminUsers = allUsers.filter((u) => u.role === UserRole.ADMIN);
        let totalEvents = 0;
        const firstAdmin = adminUsers[0];
        if (firstAdmin) {
          const adminEvents = await storage.getAllEvents(firstAdmin.id);
          totalEvents = adminEvents.length;
        }

        return {
          totalUsers: allUsers.length,
          activeUsers: allUsers.filter((u) => u.status === UserStatus.ACTIVE)
            .length,
          totalEvents,
          period: input.period,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch system statistics",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Log Management
  // Get system logs
  getLogs: adminProcedure
    .input(adminLogsSchema)
    .query(async ({ ctx, input }) => {
      try {
        // TODO: Implement log retrieval from storage
        const logs: Log[] = [];

        return {
          logs,
          total: logs.length,
          hasMore: false,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch logs",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get single log entry
  getLog: adminProcedure.input(logIdSchema).query(async ({ ctx, input }) => {
    try {
      // TODO: Implement single log retrieval
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Log not found",
      });
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch log",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),
});
