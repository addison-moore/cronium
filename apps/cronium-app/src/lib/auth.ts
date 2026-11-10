import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcrypt";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";
import { consumeAtomicRateLimit } from "@/lib/security/atomic-rate-limiter";
import { resolveRequestClientIp } from "@/lib/security/client-ip";
import { RATE_LIMIT_UNAVAILABLE } from "@/shared/rate-limit";
import { sameOriginRedirect } from "@/lib/safe-redirect";
import { verifyTotp } from "@/lib/security/totp";
import { failureWithStack } from "@/lib/pg-errors";

// A TOTP code verifies for up to 90s (±1 step of 30s); remember it a little longer.
const TOTP_REPLAY_WINDOW_MS = 120_000;

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
    // Explicit 8-hour maximum for browser sessions (security plan Phase 1.2);
    // after that the user must reauthenticate. Server-side revocation is
    // enforced per-request via sessionVersion, independent of this expiry.
    maxAge: 8 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
        totp: { label: "Authenticator code", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        // Rate-limit credential logins per trusted client IP. This path does
        // not go through the tRPC middleware, so it is enforced here to block
        // brute force / password spraying. Atomic and FAILS CLOSED — a request
        // is denied when the limiter backend is unavailable, with its own code,
        // which the route answers with a 503 rather than NextAuth's 401.
        const headers = (req?.headers ?? {}) as Record<
          string,
          string | string[] | undefined
        >;
        const pickHeader = (name: string): string | undefined => {
          const value = headers[name];
          return Array.isArray(value) ? value[0] : value;
        };
        const clientIp =
          resolveRequestClientIp(
            pickHeader("x-forwarded-for"),
            pickHeader("x-real-ip"),
          ) ?? "unknown-ip";
        const limit = await consumeAtomicRateLimit(
          clientIp,
          "auth:credentials-login",
          { maxRequests: 10, windowMs: 60_000 },
        );
        if (!limit.allowed) {
          throw new Error(
            limit.reason === "unavailable"
              ? RATE_LIMIT_UNAVAILABLE
              : "Too many login attempts. Please try again later.",
          );
        }

        try {
          // First try to find user by username
          let user = await storage.getUserByUsername(credentials.username);

          // If not found, try by email
          user ??= await storage.getUserByEmail(credentials.username);

          if (!user) {
            return null;
          }

          // Only ACTIVE accounts may sign in (uniform null for every
          // non-active status; INVITED accounts must finish activation).
          if (user.status !== UserStatus.ACTIVE) {
            return null;
          }

          // Validate the password directly (no encryption handling needed)
          const isValidPassword = await compare(
            credentials.password,
            user.password ?? "",
          );

          if (!isValidPassword) {
            return null;
          }

          // Second factor: once the password is correct, enforce TOTP for
          // MFA-enabled accounts. A specific error here only reveals MFA status
          // to someone who already proved the password (acceptable).
          if (user.mfaEnabled) {
            const submitted = (credentials.totp ?? "").trim();
            if (!submitted) {
              throw new Error("MFA_REQUIRED");
            }
            const secret = await storage.getMfaSecret(user.id);
            const totpOk = secret ? verifyTotp(secret, submitted) : false;
            if (totpOk) {
              // RFC 6238 §5.2: a code must not be accepted twice. Without this
              // a code read off someone's screen stays good for the whole
              // ±1-step window. Keyed on the code and held past that window.
              // A code whose use couldn't be recorded is refused too, but it
              // isn't called invalid: it's good for another try shortly.
              const firstUse = await consumeAtomicRateLimit(
                `${user.id}:${submitted}`,
                "auth:totp-used",
                { maxRequests: 1, windowMs: TOTP_REPLAY_WINDOW_MS },
              );
              if (!firstUse.allowed) {
                throw new Error(
                  firstUse.reason === "unavailable"
                    ? RATE_LIMIT_UNAVAILABLE
                    : "Invalid authenticator or recovery code.",
                );
              }
            } else {
              // Fall back to a single-use recovery code.
              const { hashRecoveryCode } =
                await import("@/lib/security/mfa-recovery");
              const recoveryOk = await storage.consumeMfaRecoveryCode(
                user.id,
                hashRecoveryCode(submitted),
              );
              if (!recoveryOk) {
                throw new Error("Invalid authenticator or recovery code.");
              }
            }
          }

          // Update last login time
          await storage.updateUser(user.id, {
            lastLogin: new Date(),
          });

          return {
            id: user.id,
            email: user.email,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
            role: user.role,
            status: user.status,
            sessionVersion: user.sessionVersion,
          };
        } catch (error) {
          // MFA challenge signals must reach the client (they drive the
          // second-factor UI), and so must a code the limiter couldn't check,
          // or it would read as a wrong password. Every other error is a
          // generic auth failure.
          if (
            error instanceof Error &&
            (error.message === "MFA_REQUIRED" ||
              error.message === "Invalid authenticator or recovery code." ||
              error.message === RATE_LIMIT_UNAVAILABLE)
          ) {
            throw error;
          }
          console.error("Error in authorize:", failureWithStack(error));
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email ?? null;
        token.username = user.username ?? null;
        token.firstName = user.firstName ?? null;
        token.lastName = user.lastName ?? null;
        token.profileImageUrl = user.profileImageUrl ?? null;
        token.role = user.role;
        token.status = user.status;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id;
        session.user.username = token.username!;
        session.user.firstName = token.firstName!;
        session.user.lastName = token.lastName!;
        session.user.profileImageUrl = token.profileImageUrl!;
        session.user.role = token.role;
        session.user.status = token.status;
        session.user.sessionVersion = token.sessionVersion;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      return sameOriginRedirect(url, baseUrl) ?? baseUrl;
    },
  },
};
