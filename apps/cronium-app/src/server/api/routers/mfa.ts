import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { storage } from "@/server/storage";
import { encryptionService } from "@/lib/encryption-service";
import {
  buildOtpAuthUri,
  generateTotpSecret,
  verifyTotp,
} from "@/lib/security/totp";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from "@/lib/security/mfa-recovery";

/** Re-authenticate the caller by verifying their current password. */
async function requireReauth(userId: string, password: string): Promise<void> {
  const user = await storage.getUser(userId);
  if (!user?.password) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const ok = await encryptionService.verifyPassword(password, user.password);
  if (!ok) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Your current password is incorrect.",
    });
  }
}

const reauthInput = z.object({
  password: z.string().min(1, "Your current password is required"),
});
const codeInput = z.object({ code: z.string().min(6).max(10) });

export const mfaRouter = createTRPCRouter({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const user = await storage.getUser(ctx.session.user.id);
    return {
      enabled: Boolean(user?.mfaEnabled),
      recoveryCodesRemaining: user?.mfaRecoveryCodes?.length ?? 0,
    };
  }),

  // Start enrollment: mint a pending secret and return the otpauth URI. The
  // secret is not active until confirmEnrollment proves possession.
  beginEnrollment: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await storage.getUser(ctx.session.user.id);
    if (user?.mfaEnabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "MFA is already enabled. Disable it first to re-enroll.",
      });
    }
    const secret = generateTotpSecret();
    await storage.setPendingMfaSecret(ctx.session.user.id, secret);
    const account = user?.email ?? user?.username ?? ctx.session.user.id;
    return { secret, otpauthUri: buildOtpAuthUri(secret, account) };
  }),

  // Confirm enrollment: reauthenticate, verify a live TOTP code against the
  // pending secret, then enable MFA and return one-time recovery codes.
  confirmEnrollment: protectedProcedure
    .input(reauthInput.merge(codeInput))
    .mutation(async ({ ctx, input }) => {
      await requireReauth(ctx.session.user.id, input.password);
      const secret = await storage.getMfaSecret(ctx.session.user.id);
      if (!secret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start enrollment again — no pending secret was found.",
        });
      }
      if (!verifyTotp(secret, input.code)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That code is invalid or expired. Try the current code.",
        });
      }
      const { plaintext, hashes } = generateRecoveryCodes();
      await storage.enableMfa(ctx.session.user.id, hashes);
      return { recoveryCodes: plaintext };
    }),

  // Disable MFA: reauthenticate and verify a current TOTP or recovery code.
  disable: protectedProcedure
    .input(reauthInput.merge(codeInput))
    .mutation(async ({ ctx, input }) => {
      await requireReauth(ctx.session.user.id, input.password);
      const user = await storage.getUser(ctx.session.user.id);
      if (!user?.mfaEnabled) {
        return { success: true };
      }
      const secret = await storage.getMfaSecret(ctx.session.user.id);
      const totpOk = secret ? verifyTotp(secret, input.code) : false;
      const recoveryOk = totpOk
        ? false
        : await storage.consumeMfaRecoveryCode(
            ctx.session.user.id,
            hashRecoveryCode(input.code),
          );
      if (!totpOk && !recoveryOk) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A valid authenticator or recovery code is required.",
        });
      }
      await storage.disableMfa(ctx.session.user.id);
      return { success: true };
    }),

  // Regenerate recovery codes (invalidates the old set). Requires reauth and
  // that MFA is currently enabled.
  regenerateRecoveryCodes: protectedProcedure
    .input(reauthInput)
    .mutation(async ({ ctx, input }) => {
      await requireReauth(ctx.session.user.id, input.password);
      const user = await storage.getUser(ctx.session.user.id);
      if (!user?.mfaEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enable MFA before generating recovery codes.",
        });
      }
      const { plaintext, hashes } = generateRecoveryCodes();
      await storage.replaceMfaRecoveryCodes(ctx.session.user.id, hashes);
      return { recoveryCodes: plaintext };
    }),
});
