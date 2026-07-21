import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcrypt";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";
import { RateLimitService } from "@/lib/rate-limit-service";

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
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        // Rate-limit credential logins per client IP. This path does not go
        // through the tRPC withRateLimit middleware, so it is enforced here to
        // block brute force / password spraying. Fails open if Redis is down
        // (matching RateLimitService behaviour elsewhere).
        const headers = (req?.headers ?? {}) as Record<
          string,
          string | string[] | undefined
        >;
        const pickHeader = (name: string): string | undefined => {
          const value = headers[name];
          return Array.isArray(value) ? value[0] : value;
        };
        const clientIp =
          pickHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
          pickHeader("x-real-ip") ??
          "unknown";
        const { allowed } = await RateLimitService.tryCheckLimit(
          clientIp,
          "auth:credentials-login",
          { maxRequests: 10, windowMs: 60_000 },
        );
        if (!allowed) {
          throw new Error("Too many login attempts. Please try again later.");
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
          console.error("Error in authorize:", error);
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
      if (url.startsWith(baseUrl)) {
        return url;
      }

      if (url.startsWith("/")) {
        return url;
      }

      return baseUrl;
    },
  },
};
