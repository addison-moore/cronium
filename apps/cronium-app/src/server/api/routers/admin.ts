import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "../trpc";
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
  systemStatsSchema,
} from "@/shared/schemas/admin";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";
import { sendInvitationEmail, sendEmailDetailed } from "@/lib/email";
import { listAvailableModels } from "@/lib/ai";
import { AI_PROVIDER_IDS } from "@/shared/ai-providers";

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
          enableRegistration: settingsObject.enableRegistration ?? false,
          enableGuestAccess: settingsObject.enableGuestAccess ?? false,
          defaultUserRole: settingsObject.defaultUserRole ?? UserRole.USER,
          sessionTimeout: settingsObject.sessionTimeout ?? 3600,
          logRetentionDays: settingsObject.logRetentionDays ?? 30,

          // SMTP settings
          smtpHost: settingsObject.smtpHost ?? "",
          // Stored numeric-looking strings ("587") round-trip through JSON.parse
          // as numbers; the settings schemas expect a string
          smtpPort:
            typeof settingsObject.smtpPort === "number"
              ? String(settingsObject.smtpPort)
              : (settingsObject.smtpPort ?? "587"),
          smtpUser: settingsObject.smtpUser ?? "",
          smtpPassword: settingsObject.smtpPassword ?? "",
          smtpFromEmail: settingsObject.smtpFromEmail ?? "",
          smtpFromName: settingsObject.smtpFromName ?? "Cronium",
          allowRegistration: settingsObject.allowRegistration ?? false,
          requireAdminApproval: settingsObject.requireAdminApproval ?? false,

          // AI settings
          aiEnabled: settingsObject.aiEnabled ?? false,
          aiProvider: settingsObject.aiProvider ?? "openai",
          aiModel: settingsObject.aiModel ?? "",
          openaiApiKey: settingsObject.openaiApiKey ?? "",
          anthropicApiKey: settingsObject.anthropicApiKey ?? "",
          geminiApiKey: settingsObject.geminiApiKey ?? "",
          customAiApiKey: settingsObject.customAiApiKey ?? "",
          customAiBaseUrl: settingsObject.customAiBaseUrl ?? "",
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

  // List the models currently available from an AI provider. A mutation (not a
  // query) so the API key travels in the POST body instead of a GET URL.
  listAiModels: adminProcedure
    .input(
      z.object({
        provider: z.enum(AI_PROVIDER_IDS),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const result = await listAvailableModels(
            input.provider,
            input.apiKey?.trim() ? input.apiKey.trim() : undefined,
            input.baseUrl?.trim() ? input.baseUrl.trim() : undefined,
          );
          return resourceResponse(result);
        },
        {
          component: "adminRouter",
          operationName: "listAiModels",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Send a test email using the saved system SMTP settings
  sendTestEmail: adminProcedure
    .input(z.object({ to: z.string().email().optional() }))
    .mutation(async ({ ctx, input }) => {
      const recipient = input.to ?? ctx.session.user.email;
      if (!recipient) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No recipient email address available",
        });
      }

      try {
        const result = await sendEmailDetailed({
          to: recipient,
          subject: "Cronium test email",
          text: "This is a test email from Cronium. Your SMTP settings are working.",
          html: "<p>This is a test email from Cronium. Your SMTP settings are working.</p>",
        });
        return {
          success: true,
          message: `Test email sent to ${recipient} (message ID: ${result.messageId})`,
        };
      } catch (error) {
        if (error instanceof Error && error.message === "SMTP_CONFIG_MISSING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "SMTP is not configured. Save your SMTP settings first, then send a test email.",
          });
        }
        return {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to send test email",
        };
      }
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

  // Role Management
  // Get all roles. protectedProcedure (not admin): role definitions aren't
  // sensitive, and every user's client needs them to resolve nav permissions
  // (usePermissions).
  getRoles: protectedProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        const storedRoles = await storage.listRoles();

        const items = storedRoles.map((role) => {
          const permissions = (role.permissions ?? {}) as Partial<{
            console: boolean;
            monitoring: boolean;
            localServerAccess: boolean;
          }>;
          return {
            id: role.id,
            name: role.name,
            description: role.description ?? "",
            permissions: {
              console: permissions.console ?? false,
              monitoring: permissions.monitoring ?? false,
              localServerAccess: permissions.localServerAccess ?? false,
            },
            isDefault: role.isDefault,
            createdAt: role.createdAt.toISOString(),
            updatedAt: role.updatedAt.toISOString(),
          };
        });

        return listResponse({
          items,
          total: items.length,
          hasMore: false,
          limit: items.length,
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
          const role = await storage.getRoleById(input.roleId);
          if (!role) {
            throw notFoundError("Role");
          }

          // The Admin role bypasses granular checks everywhere; persisting
          // reduced permissions for it would make the UI lie
          if (role.name.toLowerCase() === "admin") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The Admin role's permissions cannot be changed",
            });
          }

          const updated = await storage.updateRolePermissions(
            input.roleId,
            input.permissions,
          );

          return mutationResponse(
            {
              roleId: input.roleId,
              permissions: updated?.permissions ?? input.permissions,
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
});
