# tRPC API Structure Guide

This document outlines tRPC API patterns and conventions that can be applied to any full-stack TypeScript project. The examples are generalized and can be adapted for various use cases.

## Core Configuration

### 1. Base tRPC Setup

```typescript
// src/server/api/trpc.ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/server/db";

// Context creation - available in all procedures
export const createTRPCContext = async (opts: { headers: Headers }) => {
  return {
    db,
    ...opts,
  };
};

// Initialize tRPC with configuration
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson, // Handles Date, BigInt, etc.
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// Base procedure - extend this for protected procedures
export const publicProcedure = t.procedure;
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
```

### 2. Root Router Organization

```typescript
// src/server/api/root.ts
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { authRouter } from "./routers/auth";
import { createTRPCRouter } from "./trpc";

// Combine all routers
export const appRouter = createTRPCRouter({
  user: userRouter,
  post: postRouter,
  auth: authRouter,
});

// Export type definition for client
export type AppRouter = typeof appRouter;

// Server-side caller factory
export const createCaller = createCallerFactory(appRouter);
```

## Router Implementation Patterns

### 3. Basic Router Structure

```typescript
// src/server/api/routers/user.ts
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const userRouter = createTRPCRouter({
  // Query: Read operations
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, email: true },
      });
    }),

  // Query: List operations
  getAll: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(10),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findMany({
        take: input.limit,
        skip: input.offset,
        orderBy: { createdAt: "desc" },
      });
    }),

  // Mutation: Create operations
  create: publicProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
      role: z.enum(["USER", "ADMIN"]).default("USER"),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.create({
        data: input,
      });
    }),

  // Mutation: Update operations
  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;
      return ctx.db.user.update({
        where: { id },
        data: updateData,
      });
    }),

  // Mutation: Delete operations
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.delete({
        where: { id: input.id },
      });
    }),
});
```

## Input Validation with Zod

### 4. Validation Schema Patterns

```typescript
// src/schemas/user.ts
import { z } from "zod";

// Basic validation schema
export const createUserSchema = z.object({
  name: z.string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters")
    .trim(),
  email: z.string()
    .email("Invalid email format")
    .toLowerCase(),
  age: z.number()
    .int("Age must be a whole number")
    .min(13, "Must be at least 13 years old")
    .max(120, "Invalid age"),
  role: z.enum(["USER", "ADMIN", "MODERATOR"], {
    required_error: "Please select a role",
  }),
  preferences: z.object({
    newsletter: z.boolean().default(false),
    notifications: z.boolean().default(true),
  }).optional(),
});

// Infer TypeScript type from schema
export type CreateUserInput = z.infer<typeof createUserSchema>;

// Partial schema for updates
export const updateUserSchema = createUserSchema.partial().extend({
  id: z.string().uuid(),
});

// Schema composition
export const userQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(["USER", "ADMIN", "MODERATOR"]).optional(),
  limit: z.number().min(1).max(100).default(10),
  offset: z.number().min(0).default(0),
});
```

## Authentication & Authorization

### 5. Protected Procedures

```typescript
// src/server/api/trpc.ts
import { TRPCError } from "@trpc/server";

// Middleware for authentication
const enforceUserIsAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

// Protected procedure
export const protectedProcedure = t.procedure.use(enforceUserIsAuthenticated);

// Admin-only procedure
const enforceUserIsAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.session.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

export const adminProcedure = t.procedure.use(enforceUserIsAdmin);
```

### 6. Usage with Different Procedure Types

```typescript
// src/server/api/routers/user.ts
export const userRouter = createTRPCRouter({
  // Public - no authentication required
  getPublicProfile: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, avatar: true },
      });
    }),

  // Protected - requires authentication
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
      });
    }),

  // Admin-only - requires admin role
  getAllUsers: adminProcedure
    .input(userQuerySchema)
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findMany({
        where: {
          role: input.role,
          name: input.search ? { contains: input.search } : undefined,
        },
        take: input.limit,
        skip: input.offset,
      });
    }),
});
```

## Error Handling Patterns

### 7. Consistent Error Handling

```typescript
// Server-side error handling
export const userRouter = createTRPCRouter({
  getUser: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return user;
    }),

  createUser: publicProcedure
    .input(createUserSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.user.create({
          data: input,
        });
      } catch (error) {
        if (error.code === "P2002") { // Prisma unique constraint
          throw new TRPCError({
            code: "CONFLICT",
            message: "User with this email already exists",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }
    }),
});
```

## Client-Side Setup

### 8. React Client Configuration

```typescript
// src/trpc/react.tsx
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import { type AppRouter } from "@/server/api/root";

export const api = createTRPCReact<AppRouter>();

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}
```

### 9. Client Usage Examples

```typescript
// Component usage
import { api } from "@/trpc/react";

function UserProfile({ userId }: { userId: string }) {
  // Query
  const { data: user, isLoading, error } = api.user.getById.useQuery(
    { id: userId },
    {
      enabled: !!userId, // Only run query if userId exists
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  // Mutation
  const updateUser = api.user.update.useMutation({
    onSuccess: () => {
      // Invalidate and refetch user data
      api.useUtils().user.getById.invalidate({ id: userId });
    },
    onError: (error) => {
      console.error("Update failed:", error.message);
    },
  });

  const handleUpdate = (data: UpdateUserInput) => {
    updateUser.mutate(data);
  };

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h1>{user?.name}</h1>
      <p>{user?.email}</p>
      {/* Update form */}
    </div>
  );
}

// List with pagination
function UserList() {
  const [page, setPage] = useState(0);
  const limit = 10;

  const { data: users, isLoading } = api.user.getAll.useQuery({
    limit,
    offset: page * limit,
  });

  const { data: nextPage } = api.user.getAll.useQuery({
    limit,
    offset: (page + 1) * limit,
  }, {
    enabled: !!users?.length, // Prefetch next page
  });

  return (
    <div>
      {users?.map(user => (
        <div key={user.id}>{user.name}</div>
      ))}
      <button onClick={() => setPage(p => p + 1)}>Next</button>
    </div>
  );
}
```

## Advanced Patterns

### 10. Complex Business Logic

```typescript
// Service layer pattern
// src/server/services/userService.ts
export class UserService {
  constructor(private db: PrismaClient) {}

  async createUserWithProfile(input: CreateUserInput) {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: input.role,
        },
      });

      const profile = await tx.profile.create({
        data: {
          userId: user.id,
          preferences: input.preferences,
        },
      });

      return { user, profile };
    });
  }

  async deleteUserAndCleanup(userId: string) {
    return this.db.$transaction(async (tx) => {
      // Delete related records first
      await tx.post.deleteMany({ where: { authorId: userId } });
      await tx.profile.delete({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}

// Usage in router
export const userRouter = createTRPCRouter({
  createWithProfile: publicProcedure
    .input(createUserSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db);
      return userService.createUserWithProfile(input);
    }),
});
```

### 11. Subscription Patterns (WebSocket)

```typescript
// src/server/api/routers/chat.ts
import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { EventEmitter } from "events";

const ee = new EventEmitter();

export const chatRouter = createTRPCRouter({
  // Send message
  sendMessage: publicProcedure
    .input(z.object({
      message: z.string(),
      roomId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.db.message.create({
        data: {
          content: input.message,
          roomId: input.roomId,
          userId: ctx.session.user.id,
        },
      });

      ee.emit("message", message);
      return message;
    }),

  // Subscribe to messages
  onMessage: publicProcedure
    .input(z.object({ roomId: z.string() }))
    .subscription(({ input }) => {
      return observable<Message>((emit) => {
        const onMessage = (data: Message) => {
          if (data.roomId === input.roomId) {
            emit.next(data);
          }
        };

        ee.on("message", onMessage);
        return () => {
          ee.off("message", onMessage);
        };
      });
    }),
});
```

## Best Practices

### 12. Recommended Patterns

**Schema Organization:**
```typescript
// Group related schemas together
// src/schemas/index.ts
export * from "./user";
export * from "./post";
export * from "./auth";
```

**Error Handling:**
```typescript
// Consistent error responses
const handleDatabaseError = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        throw new TRPCError({
          code: "CONFLICT",
          message: "Resource already exists",
        });
      case "P2025":
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Resource not found",
        });
    }
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Database operation failed",
  });
};
```

**Performance Optimizations:**
```typescript
// Batch queries
const batchedQueries = api.useQueries([
  { queryKey: ["user", userId], queryFn: () => api.user.getById.query({ id: userId }) },
  { queryKey: ["posts", userId], queryFn: () => api.post.getByUserId.query({ userId }) },
]);

// Optimistic updates
const updateUser = api.user.update.useMutation({
  onMutate: async (newData) => {
    await queryClient.cancelQueries({ queryKey: ["user", newData.id] });
    const previousUser = queryClient.getQueryData(["user", newData.id]);
    queryClient.setQueryData(["user", newData.id], newData);
    return { previousUser };
  },
  onError: (err, newData, context) => {
    queryClient.setQueryData(["user", newData.id], context?.previousUser);
  },
});
```

This structure provides a solid foundation for any tRPC-based application with proper type safety, error handling, and performance considerations.