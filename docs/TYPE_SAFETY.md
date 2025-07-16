# TypeScript Type Safety Guide

This document provides comprehensive guidelines for maintaining type safety throughout the Cronium codebase, including both fundamental principles and advanced patterns.

## Table of Contents

1. [Core Principles](#core-principles)
2. [Type System Overview](#type-system-overview)
3. [Fundamental Patterns](#fundamental-patterns)
4. [Advanced Patterns](#advanced-patterns)
5. [Migration Strategies](#migration-strategies)
6. [Tool Configuration](#tool-configuration)
7. [Best Practices](#best-practices)

## Core Principles

### 1. Zero Tolerance for `any`

```typescript
// ❌ Never use 'any'
function processData(data: any): any {
  return data.someProperty;
}

// ✅ Use specific types or generics
function processData<T extends { someProperty: unknown }>(
  data: T,
): T["someProperty"] {
  return data.someProperty;
}

// ✅ Use 'unknown' when type is truly unknown
function processUnknownData(data: unknown): string {
  if (typeof data === "object" && data !== null && "name" in data) {
    return String(data.name);
  }
  throw new Error("Invalid data structure");
}
```

### 2. Prefer Type Safety Over Convenience

```typescript
// ❌ Convenient but unsafe
const config = JSON.parse(configString);
config.database.host = "localhost";

// ✅ Type-safe with validation
interface Config {
  database: {
    host: string;
    port: number;
  };
}

const config: Config = JSON.parse(configString);
// TypeScript will catch errors if config doesn't match interface
```

### 3. Use the Type System to Prevent Runtime Errors

```typescript
// ❌ Runtime error prone
function getUserRole(user: any): string {
  return user.role; // What if user is null or role doesn't exist?
}

// ✅ Compile-time safe
interface User {
  id: string;
  role: "admin" | "user" | "viewer";
}

function getUserRole(user: User): User["role"] {
  return user.role; // TypeScript ensures user has role property
}

function getUserRoleSafe(user: User | null): User["role"] | null {
  return user?.role ?? null; // Handles null case explicitly
}
```

## Type System Overview

### Available Types from Central Library

```typescript
// Core utility types
import type {
  Nullable,
  Optional,
  SafeAny, // Use instead of 'any' - resolves to 'never'
  ApiResponse,
  PaginatedResponse,
  ErrorResponse,
  LoadingState,
} from "@/types";

// API-specific types
import type {
  EventsResponse,
  EventResponse,
  UserResponse,
  DashboardStatsResponse,
} from "@/types/api";

// Event handler types
import type {
  ClickHandler,
  FormSubmitHandler,
  ValueChangeHandler,
  EventExecutionData,
} from "@/types/events";
```

### Database Entity Types

```typescript
// Use Drizzle-generated types
import type { Event, User, Server } from "@shared/schema";

// Extend with computed properties
interface EventWithStats extends Event {
  executionCount: number;
  lastRun: Date | null;
  averageDuration: number;
}
```

## Fundamental Patterns

### 1. tRPC Query and Mutation Patterns

```typescript
// ✅ Type-safe tRPC queries
const {
  data: events,
  error,
  isLoading,
} = trpc.events.getAll.useQuery({
  limit: 20,
  offset: 0,
});

// ✅ Type-safe mutations
const createEventMutation = trpc.events.create.useMutation({
  onSuccess: (newEvent) => {
    // newEvent is fully typed
    toast.success(`Event "${newEvent.name}" created successfully`);
  },
  onError: (error) => {
    // error is typed as TRPCError
    toast.error(error.message);
  },
});

// ✅ Server-side procedures
export const eventsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      // input and ctx are fully typed
      return await ctx.db.events.findMany({
        take: input.limit,
        skip: input.offset,
      });
    }),
});
```

### 2. Form Handling

```typescript
// ✅ Type-safe with React Hook Form + Zod
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createEventSchema } from "@shared/schemas/events";

interface EventFormData {
  name: string;
  type: EventType;
  content: string;
  status: EventStatus;
}

const form = useForm<EventFormData>({
  resolver: zodResolver(createEventSchema),
});
// Automatic validation and type safety
```

### 3. State Management

```typescript
// ✅ Typed state with discriminated unions
type DataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: Event[] }
  | { status: "error"; error: string };

const [state, setState] = useState<DataState>({ status: "idle" });

// ✅ Use LoadingState utility type
import type { LoadingState } from "@/types";

const [eventState, setEventState] = useState<LoadingState<Event[]>>({
  status: "idle",
});
```

### 4. Type Guards and Assertion Functions

```typescript
// Type guard
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isEvent(value: unknown): value is Event {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "type" in value
  );
}

// Assertion function
function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || "Value must be defined");
  }
}

// Usage
if (isEvent(unknownData)) {
  // TypeScript knows unknownData is Event
  console.log(unknownData.name);
}
```

## Advanced Patterns

### 1. Template Literal Types

```typescript
// API route validation
type ApiRoute<T extends string = string> = `/api/${T}`;

// Dashboard route patterns
type DashboardRoute =
  | `/dashboard`
  | `/dashboard/events`
  | `/dashboard/events/${number}`
  | `/dashboard/events/${number}/edit`;

// Usage
const validRoute: DashboardRoute = "/dashboard/events/123"; // ✅ Valid
const invalidRoute: DashboardRoute = "/dashboard/invalid"; // ❌ Type error
```

### 2. Conditional Types

```typescript
// Event configuration based on event type
type EventTypeConfig<T extends EventType> = T extends EventType.HTTP_REQUEST
  ? {
      httpMethod: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
      httpUrl: string;
      httpHeaders?: Record<string, string>;
      httpBody?: string;
      content?: never; // Explicitly prevent script content
    }
  : T extends EventType.NODEJS | EventType.PYTHON | EventType.BASH
    ? {
        content: string;
        httpMethod?: never; // Explicitly prevent HTTP fields
        httpUrl?: never;
        httpHeaders?: never;
        httpBody?: never;
      }
    : never;

// Usage ensures type safety
const httpEvent: EventTypeConfig<EventType.HTTP_REQUEST> = {
  httpMethod: "POST",
  httpUrl: "https://api.example.com",
  // content: 'invalid' // ❌ Type error - content not allowed
};
```

### 3. Discriminated Unions

```typescript
// Type-safe API responses
type ApiResponse<T = unknown> =
  | { success: true; data: T; error?: never }
  | { success: false; error: string; data?: never };

// Type guards for narrow type checking
function isSuccessResponse<T>(
  response: ApiResponse<T>,
): response is { success: true; data: T } {
  return response.success === true;
}

// Usage with type narrowing
async function handleApiCall() {
  const response = await fetchData();

  if (isSuccessResponse(response)) {
    // TypeScript knows response.data exists
    console.log(response.data);
  } else {
    // TypeScript knows response.error exists
    console.error(response.error);
  }
}
```

### 4. Branded Types

```typescript
// Prevent mixing different ID types
export type UserId = string & { readonly __brand: "UserId" };
export type EventId = number & { readonly __brand: "EventId" };

// Constructor functions ensure proper creation
export const createUserId = (id: string): UserId => id as UserId;
export const createEventId = (id: number): EventId => id as EventId;

// Function that only accepts EventId
function updateEvent(eventId: EventId, data: EventData) {
  // Implementation
}

// Usage
const userId = createUserId("user-123");
const eventId = createEventId(456);

updateEvent(eventId, data); // ✅ Valid
updateEvent(456, data); // ❌ Type error - raw number not allowed
updateEvent(userId, data); // ❌ Type error - UserId not EventId
```

### 5. Mapped Types

```typescript
// Transform all properties to form field states
type EventFormState<T extends Record<string, any>> = {
  [K in keyof T]: FormFieldState;
};

// Make specific properties optional
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Create update types automatically
type UpdateEvent = Partial<Omit<Event, "id" | "createdAt" | "updatedAt">>;
```

### 6. Complex Form Type Safety

```typescript
// Generic form data type that adapts to event type
type EventFormData<
  T extends EventType = EventType,
  S extends EventTriggerType = EventTriggerType,
  R extends RunLocation = RunLocation,
> = BaseEventData &
  EventTypeConfig<T> &
  ScheduleConfig<S> & {
    type: T;
    triggerType: S;
    runLocation: R;
    serverId: R extends RunLocation.REMOTE ? ServerId : null;
    selectedServerIds: R extends RunLocation.REMOTE ? ServerId[] : never;
    conditionalActions: ConditionalAction[];
  };

// Hook with full type safety
export function useEventForm<T extends EventType = EventType>(
  options: UseEventFormOptions<T> = {},
): UseEventFormReturn<T> {
  // Implementation ensures type safety throughout
}
```

## Migration Strategies

### 1. Gradual Migration from `any`

```typescript
// Step 1: Identify the any usage
function processApiResponse(response: any): any {
  return response.data;
}

// Step 2: Add input validation
function processApiResponse(response: unknown): unknown {
  if (typeof response === "object" && response !== null && "data" in response) {
    return (response as { data: unknown }).data;
  }
  throw new Error("Invalid API response");
}

// Step 3: Define proper types
interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
}

function processApiResponse<T>(response: ApiResponse<T>): T {
  return response.data;
}
```

### 2. Legacy Component Migration

```typescript
// Original component with any props
interface LegacyProps {
  data: any;
  onUpdate: (data: any) => void;
}

// Step 1: Define proper interfaces
interface EventData {
  id: number;
  name: string;
  status: EventStatus;
}

interface UpdatedProps {
  data: EventData;
  onUpdate: (data: EventData) => void;
}

// Step 2: Create migration wrapper
function withTypedProps<T>(
  Component: React.ComponentType<any>
): React.ComponentType<T> {
  return (props: T) => <Component {...props} />;
}

// Step 3: Gradually replace usage
const TypedEventComponent = withTypedProps<UpdatedProps>(LegacyEventComponent);
```

### 3. Test Migration Strategy

```typescript
// ✅ Typed test factories
function createMockEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    name: "Test Event",
    type: EventType.PYTHON,
    content: 'print("hello")',
    status: EventStatus.DRAFT,
    userId: "user-1",
    shared: false,
    // ... other required fields
    ...overrides,
  };
}

// Usage in tests
const testEvent = createMockEvent({ name: "Custom Test Event" });
```

## Tool Configuration

### ESLint Rules (Already Configured)

```javascript
// eslint.config.js
{
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error"
}
```

### TypeScript Configuration (Already Configured)

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "useUnknownInCatchVariables": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Best Practices

### 1. Prefer Interfaces Over Types for Objects

```typescript
// ✅ Good - interface for objects
interface EventData {
  id: number;
  name: string;
}

// ✅ Good - type for unions
type EventStatus = "ACTIVE" | "PAUSED" | "DRAFT";
```

### 2. Use Const Assertions for Better Inference

```typescript
// ✅ Good - const assertion
const eventTypes = ["NODEJS", "PYTHON", "BASH"] as const;
type EventType = (typeof eventTypes)[number]; // 'NODEJS' | 'PYTHON' | 'BASH'

// ❌ Less precise
const eventTypes = ["NODEJS", "PYTHON", "BASH"];
type EventType = (typeof eventTypes)[number]; // string
```

### 3. Avoid Deep Nesting

```typescript
// ❌ Hard to understand
type DeepConfig<T> = T extends Something
  ? T extends SomethingElse
    ? T extends Another
      ? TypeA
      : TypeB
    : TypeC
  : TypeD;

// ✅ Break into smaller types
type FirstLevel<T> = T extends Something ? SecondLevel<T> : TypeD;
type SecondLevel<T> = T extends SomethingElse ? ThirdLevel<T> : TypeC;
type ThirdLevel<T> = T extends Another ? TypeA : TypeB;
```

### 4. Use Discriminated Unions for State

```typescript
type ApiState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

function handleApiState<T>(state: ApiState<T>) {
  switch (state.status) {
    case 'loading':
      return <LoadingSpinner />;
    case 'success':
      return <DataDisplay data={state.data} />;
    case 'error':
      return <ErrorMessage error={state.error} />;
  }
}
```

### 5. Document Complex Types

```typescript
/**
 * Event configuration that adapts based on event type.
 *
 * @template T - The event type (NodeJS, Python, Bash, or HTTP_REQUEST)
 *
 * For HTTP_REQUEST: Requires HTTP-specific fields and prohibits script content
 * For script types: Requires script content and prohibits HTTP fields
 */
type EventTypeConfig<T extends EventType> = // ... implementation
```

## Common Pitfalls

### 1. Type Assertions Without Validation

```typescript
// ❌ Dangerous type assertion
const user = userData as User;
user.email.toLowerCase(); // Runtime error if userData.email is undefined

// ✅ Validated type assertion
function isUser(data: unknown): data is User {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "email" in data &&
    typeof (data as any).id === "string" &&
    typeof (data as any).email === "string"
  );
}

if (isUser(userData)) {
  const user = userData; // TypeScript knows this is User
  user.email.toLowerCase(); // Safe!
}
```

### 2. Circular Type References

```typescript
// ❌ Circular reference
type A = B & { prop: string };
type B = A & { prop2: number };

// ✅ Use proper base types
interface BaseType {
  prop: string;
}
type A = BaseType & { propA: string };
type B = BaseType & { propB: number };
```

### 3. Missing Runtime Validation

```typescript
// ❌ Type assertion without validation
const user = data as User;

// ✅ Type guard with validation
if (isValidUser(data)) {
  const user = data; // Safely typed
}
```

## Conclusion

Following these guidelines ensures:

1. **Compile-time Error Detection**: Catch errors before runtime
2. **Better Developer Experience**: IntelliSense and autocomplete
3. **Self-Documenting Code**: Types serve as documentation
4. **Refactoring Safety**: Changes are validated by the type system
5. **Team Consistency**: Shared understanding of data structures

Remember: **Type safety is not just about preventing errors—it's about creating maintainable, scalable, and reliable software.**
