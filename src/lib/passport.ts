/**
 * Passport.js Configuration for Cronium
 *
 * Secure authentication using proven strategies
 */

import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { compare } from "bcrypt";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";

// Configure local strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: "username", // Can accept username or email
      passwordField: "password",
    },
    async (username, password, done) => {
      try {
        // Find user by username or email
        let user = await storage.getUserByUsername(username);
        if (!user) {
          user = await storage.getUserByEmail(username);
        }

        if (!user) {
          return done(null, false, {
            message: "Invalid username/email or password",
          });
        }

        // Check user status
        if (user.status === UserStatus.DISABLED) {
          return done(null, false, { message: "Account is disabled" });
        }

        if (user.status === UserStatus.PENDING) {
          return done(null, false, { message: "Account is pending approval" });
        }

        // Verify password
        const isValidPassword = await compare(password, user.password ?? "");
        if (!isValidPassword) {
          return done(null, false, {
            message: "Invalid username/email or password",
          });
        }

        // Update last login
        await storage.updateUser(user.id, { lastLogin: new Date() });

        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        return done(null, userWithoutPassword);
      } catch (error) {
        console.error("Authentication error:", error);
        return done(error);
      }
    },
  ),
);

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    if (!user) {
      return done(null, false);
    }

    // Check if user is still active
    if (user.status === UserStatus.DISABLED) {
      return done(null, false);
    }

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;
    done(null, userWithoutPassword);
  } catch (error) {
    done(error);
  }
});

export default passport;
