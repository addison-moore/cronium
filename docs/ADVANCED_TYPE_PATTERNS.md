# Advanced TypeScript Patterns in Cronium

This document explains the sophisticated TypeScript patterns implemented throughout the Cronium codebase to provide maximum type safety, developer experience, and maintainability.

## Overview

The advanced type system in Cronium leverages cutting-edge TypeScript features to create a robust, type-safe development environment. These patterns eliminate entire classes of runtime errors and provide exceptional IntelliSense support.

## Core Pattern Categories

### 1. Template Literal Types

Template literal types provide compile-time string validation and autocompletion for string patterns.

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

Conditional types adapt behavior based on type parameters, enabling flexible yet type-safe APIs.

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
  // content: 'invalid' // ❌ Type error - content not allowed for HTTP events
};
```

### 3. Discriminated Unions

Discriminated unions ensure exhaustive handling of different cases with compile-time guarantees.

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
    // TypeScript knows response.data exists and response.error doesn't
    console.log(response.data);
  } else {
    // TypeScript knows response.error exists and response.data doesn't
    console.error(response.error);
  }
}
```

### 4. Mapped Types

Mapped types transform existing types systematically, ensuring consistency across related type definitions.

```typescript
// Transform all properties to form field states
type EventFormState<T extends Record<string, any>> = {
  [K in keyof T]: FormFieldState;
};

// Make specific properties optional
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Usage
type OptionalIdEvent = PartialBy<EventData, "id" | "createdAt">;
```

### 5. Branded Types

Branded types prevent mixing of semantically different but structurally identical types.

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

### 6. Type Guards and Assertion Functions

Type guards provide runtime type checking with compile-time type narrowing.

```typescript
// Type guard for enum validation
function isEnumValue<T extends Record<string, string>>(
  enumObject: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObject).includes(value as string);
}

// Assertion function for required values
function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || "Value must be defined");
  }
}

// Usage
function processEventType(type: unknown) {
  if (isEnumValue(EventType, type)) {
    // TypeScript knows type is EventType here
    switch (type) {
      case EventType.PYTHON:
        // Handle Python event
        break;
      // ... other cases
    }
  }
}
```

## Advanced Patterns in Practice

### Form Type Safety

The EventForm component demonstrates advanced type patterns working together:

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

### Conditional Action Safety

Conditional actions use discriminated unions to ensure correct configuration:

```typescript
type ConditionalAction<
  T extends ConditionalActionType = ConditionalActionType,
> = {
  id?: number;
  type: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION";
  action: T;
} & ConditionalActionConfig<T>;

// Type-safe configuration based on action type
type ConditionalActionConfig<T extends ConditionalActionType> =
  T extends ConditionalActionType.SEND_MESSAGE
    ? {
        toolId: number;
        message: string;
        emailAddresses?: string;
        emailSubject?: string;
        targetEventId?: never; // Explicitly prevent script fields
      }
    : T extends ConditionalActionType.SCRIPT
      ? {
          targetEventId: number;
          toolId?: never; // Explicitly prevent message fields
          message?: never;
          emailAddresses?: never;
          emailSubject?: never;
        }
      : never;
```

## Benefits Achieved

### 1. Compile-Time Safety

- **No runtime type errors**: All type mismatches caught at compile time
- **Impossible states prevented**: Invalid combinations rejected by type system
- **Exhaustive checking**: TypeScript ensures all cases are handled

### 2. Enhanced Developer Experience

- **Intelligent autocompletion**: IDEs provide accurate suggestions
- **Refactoring safety**: Changes propagate correctly through type system
- **Self-documenting code**: Types serve as inline documentation

### 3. Maintainability

- **Centralized type definitions**: Single source of truth for data structures
- **Consistent patterns**: Reusable type utilities across codebase
- **Evolution support**: Types adapt as requirements change

## Implementation Guidelines

### 1. Start with Simple Types

Begin with basic type definitions and gradually add complexity:

```typescript
// Start simple
interface User {
  id: string;
  name: string;
}

// Add constraints
interface User {
  id: UserId; // Branded type
  name: string;
  role: UserRole; // Enum
}

// Add conditional behavior
type UserWithPermissions<T extends UserRole> = User & {
  permissions: T extends UserRole.ADMIN ? AdminPermissions : UserPermissions;
};
```

### 2. Use Type Guards Liberally

Implement type guards for runtime validation:

```typescript
function isValidUser(data: unknown): data is User {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as User).id === "string" &&
    typeof (data as User).name === "string"
  );
}
```

### 3. Leverage Utility Types

Create utility types for common transformations:

```typescript
// Make properties nullable
type Nullable<T> = {
  [P in keyof T]: T[P] | null;
};

// Extract keys of specific type
type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];
```

### 4. Document Complex Types

Add JSDoc comments for complex type definitions:

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

## Migration Strategy

### Phase 1: Core Types

1. Define base types and enums
2. Create utility types
3. Implement type guards

### Phase 2: Component Types

1. Add type parameters to components
2. Create form-specific types
3. Implement validation types

### Phase 3: Advanced Patterns

1. Add conditional types
2. Implement discriminated unions
3. Create branded types

### Phase 4: Integration

1. Connect types across components
2. Add comprehensive validation
3. Document patterns

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

## Common Pitfalls

### 1. Circular Type References

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

### 2. Overly Complex Conditional Types

```typescript
// ❌ Too complex
type Complex<T> = T extends A ? (T extends B ? (T extends C ? X : Y) : Z) : W;

// ✅ Use function overloads or discriminated unions
function process<T extends A & B & C>(input: T): X;
function process<T extends A & B>(input: T): Y;
function process<T extends A>(input: T): Z;
function process<T>(input: T): W;
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

## Future Enhancements

### 1. Effect Types

Track side effects in the type system:

```typescript
type Effect = "read" | "write" | "network";
type SafeFunction<T, E extends Effect[]> = (input: T) => Promise<T>;
```

### 2. Nominal Typing

Stronger type isolation:

```typescript
type Nominal<T, K extends string> = T & { __brand: K };
type EventId = Nominal<number, "EventId">;
```

### 3. Dependent Types

Types that depend on runtime values:

```typescript
type LengthArray<N extends number> = readonly unknown[] & { length: N };
```

This advanced type system provides the foundation for a robust, maintainable, and error-free codebase that scales with the application's complexity.
