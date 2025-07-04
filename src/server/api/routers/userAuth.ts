import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";
import { nanoid } from "nanoid";
import { UserRole, UserStatus } from "@/shared/schema";
import { sendPasswordResetEmail } from "@/lib/email";
import { encryptionService } from "@/lib/encryption-service";

// Schemas
const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters long"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  role: z.nativeEnum(UserRole).default(UserRole.USER),
  status: z.nativeEnum(UserStatus).optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

const verifyTokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export const userAuthRouter = createTRPCRouter({
  // User registration (public)
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      try {
        const { username, email, password, role } = input;
        let { status } = input;

        // Check if username already exists
        const existingUsername = await storage.getUserByUsername(username);
        if (existingUsername) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Username already taken",
          });
        }

        // Check if email already exists
        const existingEmail = await storage.getUserByEmail(email);
        if (existingEmail) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Email already registered",
          });
        }

        // Check registration settings and determine user status (for non-admin users)
        if (role === UserRole.USER) {
          const allowRegistrationSetting =
            await storage.getSetting("allowRegistration");
          const requireAdminApprovalSetting = await storage.getSetting(
            "requireAdminApproval",
          );
          const inviteOnlySetting = await storage.getSetting("inviteOnly");

          const allowRegistration = allowRegistrationSetting?.value !== "false";
          const requireAdminApproval =
            requireAdminApprovalSetting?.value === "true";
          const inviteOnly = inviteOnlySetting?.value === "true";

          // Check if registration is allowed
          if (inviteOnly || !allowRegistration) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Registration is currently closed",
            });
          }

          // Determine user status based on admin approval requirement
          if (requireAdminApproval) {
            status = UserStatus.PENDING;
          } else {
            status = UserStatus.ACTIVE;
          }
        } else {
          // Admin users are always active by default
          status = status ?? UserStatus.ACTIVE;
        }

        // Create user
        const user = await storage.createUser({
          id: nanoid(),
          username,
          email,
          password,
          role,
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Return user without password
        const { password: _, ...userWithoutPassword } = user;

        return userWithoutPassword;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An error occurred during registration",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Forgot password (public)
  forgotPassword: publicProcedure
    .input(forgotPasswordSchema)
    .mutation(async ({ input }) => {
      try {
        const { email } = input;

        // Find user by email
        const user = await storage.getUserByEmail(email);

        // Always return success to prevent email enumeration attacks
        if (!user) {
          return {
            success: true,
            message:
              "If an account with that email exists, we've sent a password reset link.",
          };
        }

        // Check if user is active
        if (user.status !== "ACTIVE") {
          return {
            success: true,
            message:
              "If an account with that email exists, we've sent a password reset link.",
          };
        }

        // Generate reset token (valid for 1 hour)
        const resetToken = nanoid(32);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

        // Save reset token to database
        await storage.createPasswordResetToken({
          userId: user.id,
          token: resetToken,
          expiresAt,
          used: false,
        });

        // Send password reset email
        await sendPasswordResetEmail(email, resetToken);

        return {
          success: true,
          message:
            "If an account with that email exists, we've sent a password reset link.",
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An error occurred. Please try again.",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Reset password (public)
  resetPassword: publicProcedure
    .input(resetPasswordSchema)
    .mutation(async ({ input }) => {
      try {
        const { token, password } = input;

        // Validate reset token
        const resetToken = await storage.getPasswordResetToken(token);

        if (!resetToken) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired reset token.",
          });
        }

        // Get user
        const user = await storage.getUser(resetToken.userId);

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found.",
          });
        }

        // Hash the new password
        const hashedPassword = await encryptionService.hashPassword(password);

        // Update user password
        await storage.updateUser(user.id, {
          password: hashedPassword,
        });

        // Mark token as used
        await storage.markPasswordResetTokenAsUsed(token);

        // Clean up expired tokens
        await storage.deleteExpiredPasswordResetTokens();

        return {
          success: true,
          message:
            "Password reset successfully. You can now sign in with your new password.",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An error occurred. Please try again.",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Verify reset token (public)
  verifyToken: publicProcedure
    .input(verifyTokenSchema)
    .query(async ({ input }) => {
      try {
        const { token } = input;

        // Validate reset token
        const resetToken = await storage.getPasswordResetToken(token);

        if (!resetToken) {
          return {
            valid: false,
            message: "Invalid or expired reset token.",
          };
        }

        return {
          valid: true,
          message: "Token is valid.",
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to verify token",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get current user profile (protected)
  getCurrentUser: protectedProcedure.query(async ({ ctx }) => {
    try {
      const user = await storage.getUserByEmail(ctx.session.user.email);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Return user without password
      const { password: _, ...userWithoutPassword } = user;

      return userWithoutPassword;
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get user profile",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Update user profile (protected)
  updateProfile: protectedProcedure
    .input(
      z.object({
        username: z.string().min(3).optional(),
        email: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await storage.getUserByEmail(ctx.session.user.email);

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        // Check if username is taken (if updating username)
        if (input.username && input.username !== user.username) {
          const existingUser = await storage.getUserByUsername(input.username);
          if (existingUser) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Username already taken",
            });
          }
        }

        // Check if email is taken (if updating email)
        if (input.email && input.email !== user.email) {
          const existingUser = await storage.getUserByEmail(input.email);
          if (existingUser) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Email already registered",
            });
          }
        }

        // Update user
        const updatedUser = await storage.updateUser(user.id, {
          ...input,
          updatedAt: new Date(),
        });

        // Return user without password
        const { password: _, ...userWithoutPassword } = updatedUser;

        return userWithoutPassword;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update profile",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),
});
