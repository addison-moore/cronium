import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcrypt";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";

// Helper function to get the locale from a URL path
const getLocaleFromPath = (path: string | null): string => {
  if (!path) return "en"; // Default to English if no path

  // Extract locale from the path (e.g., "/es/dashboard" -> "es")
  const match = path.match(/^\/([a-z]{2})(?:\/|$)/);
  return match ? match[1] : "en";
};

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
          if (!user) {
            user = await storage.getUserByEmail(credentials.username);
          }

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
            user.password || "",
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
        token.email = user.email;
        token.username = user.username;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.profileImageUrl = user.profileImageUrl;
        token.role = user.role;
        token.status = user.status;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.firstName = token.firstName as string;
        session.user.lastName = token.lastName as string;
        session.user.profileImageUrl = token.profileImageUrl as string;
        session.user.role = token.role as UserRole;
        session.user.status = token.status as UserStatus;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // If the url is absolute and from our site (starts with baseUrl)
      // or is a relative url (starts with /)
      if (url.startsWith(baseUrl) || url.startsWith("/")) {
        // Check if the URL is a default dashboard URL without a locale
        if (url === "/dashboard" || url.startsWith("/dashboard/")) {
          // If this is a callback from signin page, check the referer to get the locale
          const referer =
            typeof window !== "undefined" ? document.referrer : null;
          const locale = getLocaleFromPath(referer);

          // Add the locale to the URL
          return `/${locale}${url}`;
        }

        // Return the URL as-is if it already has a locale or it's not a dashboard URL
        return url;
      }

      // For external URLs, return the baseUrl (don't allow redirecting to external sites)
      return baseUrl;
    },
  },
};
