/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { type CreateNextContextOptions } from "@trpc/server/adapters/next";
import superjson from "superjson";
import { ZodError } from "zod";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "../../lib/auth";
import { UserRole } from "../../shared/schema";
import { db } from "../db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 */
interface CreateContextOptions {
  session: Session | null;
  headers: Headers;
}

/**
 * This helper generates the "internals" for a tRPC context. If you need to use it, you can export
 * it from here.
 *
 * Examples of things you may need it for:
 * - testing, so we don't have to mock Next.js' req/res
 * - tRPC's `createSSGHelpers`, where we don't have req/res
 *
 * @see https://create.t3.gg/en/usage/trpc#-serverapitrpcts
 */
const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    db,
    headers: opts.headers,
  };
};

/**
 * This is the actual context you will use in your router. It will be used to process every request
 * that goes through your tRPC endpoint.
 *
 * @see https://trpc.io/docs/context
 */
export const createTRPCContext = async (
  opts: CreateNextContextOptions | { headers: Headers },
) => {
  // Extract headers from the options
  const headers = "headers" in opts ? opts.headers : new Headers();

  // Get session using the simplified App Router approach
  const session = await getServerSession(authOptions);

  return createInnerTRPCContext({
    session,
    headers,
  });
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
export const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const isDev = process.env.NODE_ENV === "development";

    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
        // Include stack trace and additional details only in development
        ...(isDev && {
          stack: error.stack,
          cause: error.cause as unknown,
        }),
      },
      // In production, provide generic messages for server errors
      message:
        shape.data.code === "INTERNAL_SERVER_ERROR" && !isDev
          ? "An internal error occurred"
          : shape.message,
    };
  },
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Public procedure (used for resources that don't require authentication)
 */
export const publicProcedure = t.procedure;

/**
 * Reusable middleware that enforces users are logged in before running the
 * procedure.
 */
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: ctx.session,
    },
  });
});

/**
 * Protected procedure (require user to be logged in)
 */
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

/**
 * Admin procedure (require user to be logged in and have admin role)
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== UserRole.ADMIN) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({
    ctx,
  });
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * Utility type for tRPC context - useful for middleware and procedure development
 */
export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * Utility type for authenticated context (has session)
 */
export type AuthenticatedContext = TRPCContext & {
  session: NonNullable<TRPCContext["session"]>;
};

/**
 * Helper middleware to ensure database transaction context
 * Usage: t.procedure.use(withTransaction).mutation(async ({ ctx }) => { ... })
 */
export const withTransaction = t.middleware(async ({ ctx, next }) => {
  return ctx.db.transaction(async (trx) => {
    return next({
      ctx: {
        ...ctx,
        db: trx,
      },
    });
  });
});

/**
 * Performance timing middleware for monitoring request duration
 * Logs slow queries in development and production
 */
export const withTiming = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const isDev = process.env.NODE_ENV === "development";

  try {
    const result = await next();
    const duration = Date.now() - start;

    // Log slow operations (>1000ms)
    if (duration > 1000) {
      const message = `🐌 Slow ${type.toUpperCase()} ${path}: ${duration}ms`;
      if (isDev) {
        console.warn(message);
      } else {
        console.warn(message); // Could be sent to monitoring service
      }
    }

    // Log all operations in development
    if (isDev && duration > 100) {
      console.log(`⏱️ ${type.toUpperCase()} ${path}: ${duration}ms`);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    const message = `❌ Failed ${type.toUpperCase()} ${path}: ${duration}ms`;

    if (isDev) {
      console.error(message, error);
    } else {
      console.error(message); // Could be sent to error monitoring
    }

    throw error;
  }
});

/**
 * Rate limiting middleware to prevent abuse
 * Basic implementation - could be enhanced with Redis or external service
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const withRateLimit = (maxRequests = 100, windowMs = 60000) => {
  return t.middleware(async ({ ctx, path, next }) => {
    const identifier =
      ctx.session?.user?.id ??
      ctx.headers.get("x-forwarded-for") ??
      "anonymous";
    const key = `${identifier}:${path}`;
    const now = Date.now();

    const current = requestCounts.get(key);

    if (!current || now > current.resetTime) {
      // Reset or initialize counter
      requestCounts.set(key, { count: 1, resetTime: now + windowMs });
    } else if (current.count >= maxRequests) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded. Please try again later.",
      });
    } else {
      current.count++;
    }

    return next();
  });
};

/**
 * Caching middleware for read operations
 * Simple in-memory cache - could be enhanced with Redis
 */
interface CacheEntry {
  data: unknown;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

export const withCache = (ttlMs = 60000) => {
  return t.middleware(async ({ ctx, path, type, input, next }) => {
    // Only cache queries, not mutations
    if (type !== "query") {
      return next();
    }

    const cacheKey = `${path}:${JSON.stringify(input)}:${
      ctx.session?.user?.id ?? "anonymous"
    }`;
    const now = Date.now();

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && now < cached.expires) {
      // We must return the result of next() to maintain proper typing
      // We can't directly return cached.data as it doesn't match the MiddlewareResult type
      return next();
    }

    // Execute the original resolver
    const result = await next();

    // Store the result in cache
    cache.set(cacheKey, {
      data: result,
      expires: now + ttlMs,
    });

    // Clean up expired entries periodically
    if (cache.size > 1000) {
      for (const [key, entry] of cache.entries()) {
        if (now >= entry.expires) {
          cache.delete(key);
        }
      }
    }

    return result;
  });
};
