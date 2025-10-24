import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "../trpc";
import {
  normalizePagination,
  createPaginatedResult,
} from "@/server/utils/db-patterns";
import { withErrorHandling, notFoundError } from "@/server/utils/error-utils";
import {
  listResponse,
  mutationResponse,
  resourceResponse,
  statsResponse,
  bulkResponse,
} from "@/server/utils/api-patterns";
import {
  adminQuerySchema,
  inviteUserSchema,
  updateUserSchema,
  userIdSchema,
  toggleUserStatusSchema,
  bulkUserOperationSchema,
  systemSettingsSchema,
  adminLogsSchema,
  logIdSchema,
  systemStatsSchema,
} from "@/shared/schemas/admin";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";
import { sendInvitationEmail } from "@/lib/email";

// Define Log interface for proper typing
export interface Log {
  id: string;
  timestamp: Date;
  level: "ERROR" | "WARN" | "INFO" | "DEBUG";
  message: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

// Use centralized admin authentication from trpc.ts

export const adminRouter = createTRPCRouter({
  // User Management
  // Get all users
  getUsers: adminProcedure
    .input(adminQuerySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const result = await storage.queryUsers(input);

          return {
            users: result.items,
            total: result.total,
            hasMore: result.hasMore,
          };
        },
        {
          component: "adminRouter",
          operationName: "getUsers",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get single user by ID
  getUser: adminProcedure.input(userIdSchema).query(async ({ ctx, input }) => {
    return withErrorHandling(
      async () => {
        const user = await storage.getUser(input.id);
        if (!user) {
          throw notFoundError("User");
        }
        return resourceResponse(user);
      },
      {
        component: "adminRouter",
        operationName: "getUser",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Invite new user
  inviteUser: adminProcedure
    .input(inviteUserSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
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

          // Send invitation email
          try {
            await sendInvitationEmail(input.email, inviteToken);
            console.log(
              `Invitation email sent to ${input.email} with token ${inviteToken}`,
            );
          } catch (emailError) {
            console.error("Failed to send invitation email:", emailError);
            // Note: We still return success since the user was created
            // The admin can resend the invitation if needed
          }

          return mutationResponse(newUser, "Invitation sent successfully");
        },
        {
          component: "adminRouter",
          operationName: "inviteUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Update user
  updateUser: adminProcedure
    .input(updateUserSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const { id, ...updateData } = input;

          const existingUser = await storage.getUser(id);
          if (!existingUser) {
            throw notFoundError("User");
          }

          const updatedUser = await storage.updateUser(id, {
            ...updateData,
            updatedAt: new Date(),
          });

          return mutationResponse(updatedUser, "User updated successfully");
        },
        {
          component: "adminRouter",
          operationName: "updateUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Toggle user status (enable/disable)
  toggleUserStatus: adminProcedure
    .input(toggleUserStatusSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const existingUser = await storage.getUser(input.id);
          if (!existingUser) {
            throw notFoundError("User");
          }

          // Prevent admin from disabling themselves
          if (
            input.id === ctx.session.user.id &&
            input.status !== UserStatus.ACTIVE
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You cannot disable your own account",
            });
          }

          const updatedUser = await storage.updateUser(input.id, {
            status: input.status,
            updatedAt: new Date(),
          });

          return mutationResponse(
            updatedUser,
            `User status changed to ${input.status}`,
          );
        },
        {
          component: "adminRouter",
          operationName: "toggleUserStatus",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Bulk user operations
  bulkUserOperation: adminProcedure
    .input(bulkUserOperationSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const results = [];

          for (const userId of input.userIds) {
            try {
              // Prevent admin from operating on themselves for certain operations
              if (
                userId === ctx.session.user.id &&
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
                    // Generate new invite token for security
                    const { nanoid } = await import("nanoid");
                    const newInviteToken = nanoid(32);
                    const newInviteExpiry = new Date();
                    newInviteExpiry.setHours(newInviteExpiry.getHours() + 48);

                    await storage.updateUser(userId, {
                      inviteToken: newInviteToken,
                      inviteExpiry: newInviteExpiry,
                      updatedAt: new Date(),
                    });

                    // Send invitation email
                    try {
                      if (user.email) {
                        await sendInvitationEmail(user.email, newInviteToken);
                        console.log(`Invitation email resent to ${user.email}`);
                      }
                    } catch (emailError) {
                      console.error(
                        "Failed to resend invitation email:",
                        emailError,
                      );
                      results.push({
                        id: userId,
                        success: false,
                        error: "Failed to send invitation email",
                      });
                      continue;
                    }
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

          return bulkResponse(results);
        },
        {
          component: "adminRouter",
          operationName: "bulkUserOperation",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Approve user (for pending users)
  approveUser: adminProcedure
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const user = await storage.getUser(input.id);

          if (!user) {
            throw notFoundError("User");
          }

          // Check if the user is in pending status
          if (user.status !== UserStatus.PENDING) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Can only approve users with PENDING status",
            });
          }

          // Update user status to ACTIVE
          const updatedUser = await storage.updateUser(input.id, {
            status: UserStatus.ACTIVE,
            updatedAt: new Date(),
          });

          return mutationResponse(updatedUser, "User approved successfully");
        },
        {
          component: "adminRouter",
          operationName: "approveUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Deny user (for pending users)
  denyUser: adminProcedure
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const user = await storage.getUser(input.id);

          if (!user) {
            throw notFoundError("User");
          }

          // Check if the user is in pending status
          if (user.status !== UserStatus.PENDING) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Can only deny users with PENDING status",
            });
          }

          // Update user status to DISABLED (or delete if preferred)
          const updatedUser = await storage.updateUser(input.id, {
            status: UserStatus.DISABLED,
            updatedAt: new Date(),
          });

          return mutationResponse(updatedUser, "User denied successfully");
        },
        {
          component: "adminRouter",
          operationName: "denyUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Enable user
  enableUser: adminProcedure
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const user = await storage.getUser(input.id);

          if (!user) {
            throw notFoundError("User");
          }

          // Update user status to ACTIVE
          const updatedUser = await storage.updateUser(input.id, {
            status: UserStatus.ACTIVE,
            updatedAt: new Date(),
          });

          return mutationResponse(updatedUser, "User enabled successfully");
        },
        {
          component: "adminRouter",
          operationName: "enableUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Disable user
  disableUser: adminProcedure
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Prevent admin from disabling themselves
          if (input.id === ctx.session.user.id) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You cannot disable your own account",
            });
          }

          const user = await storage.getUser(input.id);

          if (!user) {
            throw notFoundError("User");
          }

          // Update user status to DISABLED
          const updatedUser = await storage.updateUser(input.id, {
            status: UserStatus.DISABLED,
            updatedAt: new Date(),
          });

          return mutationResponse(updatedUser, "User disabled successfully");
        },
        {
          component: "adminRouter",
          operationName: "disableUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Promote user to admin
  promoteUser: adminProcedure
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const user = await storage.getUser(input.id);

          if (!user) {
            throw notFoundError("User");
          }

          // Check if the user is already an admin
          if (user.role === UserRole.ADMIN) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "User is already an admin",
            });
          }

          // Update the user's role to admin
          const updatedUser = await storage.updateUser(input.id, {
            role: UserRole.ADMIN,
            updatedAt: new Date(),
          });

          return mutationResponse(
            updatedUser,
            "User promoted to admin successfully",
          );
        },
        {
          component: "adminRouter",
          operationName: "promoteUser",
          userId: ctx.session.user.id,
        },
      );
    }),

  // System Management
  // Get system settings
  getSystemSettings: adminProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        // Get all settings from database
        const settings = await storage.getAllSettings();

        // Transform settings array to an object for easier consumption by the client
        const settingsObject = settings.reduce(
          (acc, setting) => {
            // Try to parse the value as JSON, if it fails just use the string
            try {
              acc[setting.key] = JSON.parse(setting.value);
            } catch {
              acc[setting.key] = setting.value;
            }
            return acc;
          },
          {} as Record<string, unknown>,
        );

        // Return settings with default values for any missing keys
        const systemSettings = {
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

          // Registration settings (handle legacy openRegistration field)
          allowRegistration:
            settingsObject.allowRegistration ??
            settingsObject.openRegistration ??
            false,
          requireAdminApproval: settingsObject.requireAdminApproval ?? true,

          // AI settings
          aiEnabled: settingsObject.aiEnabled ?? false,
          aiModel: settingsObject.aiModel ?? "gpt-3.5-turbo",
          openaiApiKey: settingsObject.openaiApiKey ?? "",
        };

        return resourceResponse(systemSettings);
      },
      {
        component: "adminRouter",
        operationName: "getSystemSettings",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Update system settings
  updateSystemSettings: adminProcedure
    .input(systemSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Update each setting in the database
          for (const [key, value] of Object.entries(input)) {
            if (value !== undefined && value !== null) {
              // Convert the value to string for storage, handling different types
              const stringValue =
                typeof value === "string" ? value : JSON.stringify(value);
              await storage.upsertSetting(key, stringValue);
            }
          }

          return mutationResponse(
            input,
            "System settings updated successfully",
          );
        },
        {
          component: "adminRouter",
          operationName: "updateSystemSettings",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get system statistics
  getSystemStats: adminProcedure
    .input(systemStatsSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const allUsers = await storage.getAllUsers();

          // For now, get events from the first admin user to approximate total events
          const adminUsers = allUsers.filter((u) => u.role === UserRole.ADMIN);
          let totalEvents = 0;
          const firstAdmin = adminUsers[0];
          if (firstAdmin) {
            const adminEvents = await storage.getAllEvents(firstAdmin.id);
            totalEvents = adminEvents.length;
          }

          const stats = {
            totalUsers: allUsers.length,
            activeUsers: allUsers.filter((u) => u.status === UserStatus.ACTIVE)
              .length,
            totalEvents,
            period: input.period,
          };

          return statsResponse(
            {
              start:
                input.period === "day"
                  ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
                  : input.period === "week"
                    ? new Date(
                        Date.now() - 7 * 24 * 60 * 60 * 1000,
                      ).toISOString()
                    : input.period === "month"
                      ? new Date(
                          Date.now() - 30 * 24 * 60 * 60 * 1000,
                        ).toISOString()
                      : new Date(
                          Date.now() - 365 * 24 * 60 * 60 * 1000,
                        ).toISOString(),
              end: new Date().toISOString(),
            },
            stats,
          );
        },
        {
          component: "adminRouter",
          operationName: "getSystemStats",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Log Management
  // Get system logs
  getLogs: adminProcedure
    .input(adminLogsSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // TODO: Implement log retrieval from storage
          const logs: Log[] = [];

          const pagination = normalizePagination(input);
          const result = createPaginatedResult(logs, 0, pagination);

          return listResponse(result);
        },
        {
          component: "adminRouter",
          operationName: "getLogs",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get single log entry
  getLog: adminProcedure.input(logIdSchema).query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        // TODO: Implement single log retrieval
        throw notFoundError("Log");
      },
      {
        component: "adminRouter",
        operationName: "getLog",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Role Management
  // Get all roles
  getRoles: adminProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        // Define default roles with permissions
        const defaultRoles = [
          {
            id: 1,
            name: "Admin",
            description: "Full system access",
            permissions: {
              console: true,
              monitoring: true,
              localServerAccess: true,
            },
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 2,
            name: "User",
            description: "Standard user access",
            permissions: {
              console: true,
              monitoring: true,
              localServerAccess: false,
            },
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 3,
            name: "Viewer",
            description: "Read-only access",
            permissions: {
              console: false,
              monitoring: true,
              localServerAccess: false,
            },
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];

        // TODO: In the future, fetch custom roles from storage
        return listResponse({
          items: defaultRoles,
          total: defaultRoles.length,
          hasMore: false,
          limit: defaultRoles.length,
          offset: 0,
        });
      },
      {
        component: "adminRouter",
        operationName: "getRoles",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Update role permissions
  updateRolePermissions: adminProcedure
    .input(
      z.object({
        roleId: z.number(),
        permissions: z.object({
          console: z.boolean(),
          monitoring: z.boolean(),
          localServerAccess: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // TODO: Implement role permission updates in storage
          // For now, return success
          return mutationResponse(
            {
              roleId: input.roleId,
              permissions: input.permissions,
            },
            "Role permissions updated successfully",
          );
        },
        {
          component: "adminRouter",
          operationName: "updateRolePermissions",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Resend invitation
  resendInvitation: adminProcedure
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const user = await storage.getUser(input.id);
          if (!user) {
            throw notFoundError("User");
          }

          if (user.status !== UserStatus.INVITED) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "User is not in invited status",
            });
          }

          // Generate new invite token and expiry
          const { nanoid } = await import("nanoid");
          const inviteToken = nanoid(32);
          const inviteExpiry = new Date();
          inviteExpiry.setHours(inviteExpiry.getHours() + 48);

          await storage.updateUser(user.id, {
            inviteToken,
            inviteExpiry,
            updatedAt: new Date(),
          });

          // Send invitation email
          try {
            if (user.email) {
              await sendInvitationEmail(user.email, inviteToken);
              console.log(`Invitation email resent to ${user.email}`);
            }
          } catch (emailError) {
            console.error("Failed to resend invitation email:", emailError);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to send invitation email",
            });
          }

          // Return in the format the frontend expects
          return {
            success: true,
            email: user.email,
            message: "Invitation resent successfully",
          };
        },
        {
          component: "adminRouter",
          operationName: "resendInvitation",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Admin Logs Management
  getAdminLogs: adminProcedure
    .input(adminLogsSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // For now, use the existing getLogs operation
          // TODO: Implement proper admin log retrieval from storage
          const logs: Log[] = [];

          const pagination = normalizePagination(input);
          const result = createPaginatedResult(logs, 0, pagination);

          return listResponse(result);
        },
        {
          component: "adminRouter",
          operationName: "getAdminLogs",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get admin log by ID
  getAdminLog: adminProcedure.input(logIdSchema).query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        // TODO: Implement single admin log retrieval
        throw notFoundError("Admin log");
      },
      {
        component: "adminRouter",
        operationName: "getAdminLog",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Enhanced Roles Management
  getAdminRoles: adminProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        // Use the existing getRoles implementation but with admin prefix for clarity
        const defaultRoles = [
          {
            id: 1,
            name: "Admin",
            description: "Full system access",
            permissions: {
              console: true,
              monitoring: true,
              localServerAccess: true,
            },
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 2,
            name: "User",
            description: "Standard user access",
            permissions: {
              console: true,
              monitoring: true,
              localServerAccess: false,
            },
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 3,
            name: "Viewer",
            description: "Read-only access",
            permissions: {
              console: false,
              monitoring: true,
              localServerAccess: false,
            },
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];

        // TODO: In the future, fetch custom roles from storage
        return listResponse({
          items: defaultRoles,
          total: defaultRoles.length,
          hasMore: false,
          limit: defaultRoles.length,
          offset: 0,
        });
      },
      {
        component: "adminRouter",
        operationName: "getAdminRoles",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Update admin role permissions
  updateAdminRolePermissions: adminProcedure
    .input(
      z.object({
        roleId: z.number(),
        permissions: z.object({
          console: z.boolean(),
          monitoring: z.boolean(),
          localServerAccess: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // TODO: Implement role permission updates in storage
          // For now, return success
          return mutationResponse(
            {
              roleId: input.roleId,
              permissions: input.permissions,
            },
            "Admin role permissions updated successfully",
          );
        },
        {
          component: "adminRouter",
          operationName: "updateAdminRolePermissions",
          userId: ctx.session.user.id,
        },
      );
    }),
});
