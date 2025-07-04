# Type Safety Guidelines

This document provides comprehensive guidelines for maintaining type safety throughout the Cronium codebase and eliminating unsafe `any` types.

## Table of Contents

1. [Core Principles](#core-principles)
2. [Type System Overview](#type-system-overview)
3. [Common Patterns](#common-patterns)
4. [Anti-Patterns](#anti-patterns)
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
function processData<T extends { someProperty: unknown }>(data: T): T['someProperty'] {
  return data.someProperty;
}

// ✅ Use 'unknown' when type is truly unknown
function processUnknownData(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'name' in data) {
    return String(data.name);
  }
  throw new Error('Invalid data structure');
}
```

### 2. Prefer Type Safety Over Convenience

```typescript
// ❌ Convenient but unsafe
const config = JSON.parse(configString);
config.database.host = 'localhost';

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
  role: 'admin' | 'user' | 'viewer';
}

function getUserRole(user: User): User['role'] {
  return user.role; // TypeScript ensures user has role property
}

function getUserRoleSafe(user: User | null): User['role'] | null {
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
  LoadingState
} from '@/types';

// API-specific types
import type {
  EventsResponse,
  EventResponse,
  UserResponse,
  DashboardStatsResponse
} from '@/types/api';

// Event handler types
import type {
  ClickHandler,
  FormSubmitHandler,
  ValueChangeHandler,
  EventExecutionData
} from '@/types/events';
```

### Database Entity Types

```typescript
// Use Drizzle-generated types
import type { Event, User, Server } from '@shared/schema';

// Extend with computed properties
interface EventWithStats extends Event {
  executionCount: number;
  lastRun: Date | null;
  averageDuration: number;
}
```

## Common Patterns

### 1. API Response Handling

```typescript
// ❌ Unsafe API responses
async function fetchEvents(): Promise<any> {
  const response = await fetch('/api/events');
  return response.json();
}

// ✅ Type-safe API responses
import type { EventsResponse } from '@/types/api';

async function fetchEvents(): Promise<EventsResponse> {
  const response = await fetch('/api/events');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as EventsResponse;
}

// ✅ Even better with tRPC (auto-typed)
const { data: events, error } = trpc.events.getAll.useQuery({
  limit: 20,
  offset: 0
});
// events is automatically typed as Event[]
```

### 2. Form Handling

```typescript
// ❌ Untyped form data
function handleSubmit(event: any) {
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData);
  // data is any, no type safety
}

// ✅ Type-safe form handling
import type { FormSubmitHandler } from '@/types/events';

interface EventFormData {
  name: string;
  type: EventType;
  content: string;
  status: EventStatus;
}

const handleSubmit: FormSubmitHandler = (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  
  const data: EventFormData = {
    name: formData.get('name') as string,
    type: formData.get('type') as EventType,
    content: formData.get('content') as string,
    status: formData.get('status') as EventStatus,
  };
  
  // Validate data before submission
  createEvent(data);
};

// ✅ Even better with React Hook Form + Zod
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createEventSchema } from '@shared/schemas/events';

const form = useForm<EventFormData>({
  resolver: zodResolver(createEventSchema),
});
// Automatic validation and type safety
```

### 3. State Management

```typescript
// ❌ Untyped state
const [data, setData] = useState<any>(null);

// ✅ Typed state with discriminated unions
type DataState = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Event[] }
  | { status: 'error'; error: string };

const [state, setState] = useState<DataState>({ status: 'idle' });

// ✅ Use LoadingState utility type
import type { LoadingState } from '@/types';

const [eventState, setEventState] = useState<LoadingState<Event[]>>({ 
  status: 'idle' 
});
```

### 4. Event Handlers

```typescript
// ❌ Generic any event handlers
const handleClick = (event: any) => {
  console.log(event.target.value);
};

const handleChange = (event: any) => {
  setValue(event.target.value);
};

// ✅ Specific typed event handlers
import type { ClickHandler, ChangeEventHandler } from '@/types/events';

const handleClick: ClickHandler<HTMLButtonElement> = (event) => {
  console.log(event.currentTarget.textContent);
};

const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
  setValue(event.target.value);
};

// ✅ Value-based handlers for controlled components
import type { StringChangeHandler } from '@/types/events';

const handleValueChange: StringChangeHandler = (value) => {
  setValue(value);
};
```

### 5. Third-Party API Integration

```typescript
// ❌ Untyped third-party responses
async function sendSlackMessage(message: string): Promise<any> {
  const response = await slackClient.chat.postMessage({
    channel: '#general',
    text: message,
  });
  return response;
}

// ✅ Typed third-party responses
import type { SlackApiResponse } from '@/types/api';

async function sendSlackMessage(message: string): Promise<SlackApiResponse> {
  const response = await slackClient.chat.postMessage({
    channel: '#general',
    text: message,
  });
  
  return {
    ok: response.ok,
    channel: response.channel,
    ts: response.ts,
    error: response.error,
  } as SlackApiResponse;
}
```

## Anti-Patterns

### 1. Type Assertions Without Validation

```typescript
// ❌ Dangerous type assertion
const user = userData as User;
user.email.toLowerCase(); // Runtime error if userData.email is undefined

// ✅ Validated type assertion
function isUser(data: unknown): data is User {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    'email' in data &&
    typeof (data as any).id === 'string' &&
    typeof (data as any).email === 'string'
  );
}

if (isUser(userData)) {
  const user = userData; // TypeScript knows this is User
  user.email.toLowerCase(); // Safe!
}
```

### 2. Overly Broad Types

```typescript
// ❌ Too broad, loses type information
function processEvent(event: object): object {
  // Lost all type information
  return { ...event, processed: true };
}

// ✅ Generic with constraints
function processEvent<T extends { id: number }>(event: T): T & { processed: true } {
  return { ...event, processed: true };
}
```

### 3. Missing Null/Undefined Handling

```typescript
// ❌ Assumes data is always present
function formatUserName(user: User): string {
  return `${user.firstName} ${user.lastName}`;
}

// ✅ Handle optional properties
function formatUserName(user: User): string {
  const firstName = user.firstName ?? 'Unknown';
  const lastName = user.lastName ?? 'User';
  return `${firstName} ${lastName}`;
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
  if (typeof response === 'object' && response !== null && 'data' in response) {
    return (response as { data: unknown }).data;
  }
  throw new Error('Invalid API response');
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
// ❌ Untyped test mocks
const mockEvent = {
  id: 1,
  name: 'test'
} as any;

// ✅ Typed test factories
function createMockEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    name: 'Test Event',
    type: EventType.PYTHON,
    content: 'print("hello")',
    status: EventStatus.DRAFT,
    userId: 'user-1',
    shared: false,
    // ... other required fields
    ...overrides,
  };
}

// Usage in tests
const testEvent = createMockEvent({ name: 'Custom Test Event' });
```

## Tool Configuration

### ESLint Rules (Already Configured)

The following rules are enforced to prevent unsafe `any` usage:

```javascript
// .eslintrc.cjs
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

### Pre-commit Hooks (Already Configured)

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "bash -c 'tsc --noEmit'"
    ]
  }
}
```

## Best Practices

### 1. Use Type Guards

```typescript
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isEvent(value: unknown): value is Event {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'type' in value
  );
}

// Usage
if (isEvent(unknownData)) {
  // TypeScript knows unknownData is Event
  console.log(unknownData.name);
}
```

### 2. Use Discriminated Unions

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

### 3. Use Mapped Types for Transformations

```typescript
// Make all properties optional
type PartialEvent = Partial<Event>;

// Make specific properties required
type RequiredEventFields = Required<Pick<Event, 'name' | 'type'>>;

// Create update types automatically
type UpdateEvent = Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>;
```

### 4. Use Template Literal Types

```typescript
// For API routes
type ApiRoute = `/api/${string}`;
type EventApiRoute = `/api/events/${number}`;

// For status values
type EventStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ARCHIVED';
type LogStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';
```

### 5. Use Conditional Types for Complex Logic

```typescript
// Different return types based on input
type ApiResult<T extends 'success' | 'error'> = T extends 'success'
  ? { data: unknown; error?: never }
  : { data?: never; error: string };

function apiCall<T extends 'success' | 'error'>(
  type: T
): ApiResult<T> {
  if (type === 'success') {
    return { data: {} } as ApiResult<T>;
  } else {
    return { error: 'Failed' } as ApiResult<T>;
  }
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