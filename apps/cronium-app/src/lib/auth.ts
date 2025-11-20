import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcrypt";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        try {
          // First try to find user by username
          let user = await storage.getUserByUsername(credentials.username);

          // If not found, try by email
          user ??= await storage.getUserByEmail(credentials.username);

          if (!user) {
            return null;
          }

          // Check if user is disabled or pending approval
          if (
            user.status === UserStatus.DISABLED ||
            user.status === UserStatus.PENDING
          ) {
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
