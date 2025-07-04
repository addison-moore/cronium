# Testing Type Safety Guidelines

This document outlines best practices for maintaining type safety in our testing infrastructure.

## Overview

Our testing infrastructure should maintain the same level of type safety as our production code. This means:

- Proper typing for all test utilities and helpers
- Type-safe mocks and test doubles
- Comprehensive assertion types
- Clear interfaces for test data

## Test Utilities

### tRPC Test Utilities

Located in `src/__tests__/utils/trpc-test-utils.tsx`, these utilities provide type-safe testing for tRPC operations:

```typescript
// Type-safe mock handlers
interface MockHandlers {
  [key: string]: MockHandler | Record<string, any>;
}

// Type-safe render utilities
export const renderWithTrpc = (
  ui: React.ReactElement,
  mockHandlers: MockHandlers = {},
): RenderResult => {
  // Implementation
};

// Type-safe hook testing
export const renderHookWithTrpc = <T>(
  hook: () => T,
  mockHandlers: MockHandlers = {},
): any => {
  // Implementation
};
```

### Mock Data Factories

Use typed factory functions for creating consistent test data:

```typescript
interface MockTool {
  id: number;
  userId: string;
  name: string;
  type: string;
  credentials: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const createMockTool = (
  overrides: Partial<MockTool> = {},
): MockTool => ({
  id: 1,
  userId: "user-1",
  name: "Test Tool",
  type: "EMAIL",
  // ... rest of defaults
  ...overrides,
});
```

## Component Testing Patterns

### Proper Mock Typing

Always type your mocks with explicit interfaces:

```typescript
// ❌ Bad - any types
const mockComponent = jest.fn().mockImplementation(() => <div />);

// ✅ Good - typed mock
const mockComponent = jest.fn<React.ReactElement, []>()
  .mockImplementation(() => <div />);
```

### Event Handler Typing

Type event handlers in component mocks:

```typescript
// ✅ Properly typed event handler
jest.mock('@/components/ui/monaco-editor', () => ({
  MonacoEditor: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (value: string) => void;
    language: string;
  }): React.ReactElement => (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}));
```

### Function Return Types

Always specify return types for mock functions:

```typescript
// ✅ Explicit return types
jest.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

jest.mock("@/lib/scriptTemplates", () => ({
  getDefaultScriptContent: (type: string): string => `# Default ${type} script`,
  getDefaultHttpRequest: (): {
    method: string;
    url: string;
    headers: any[];
    body: string;
  } => ({
    method: "GET",
    url: "",
    headers: [],
    body: "",
  }),
}));
```

## Test Data Types

### Enum Usage

Always use proper enum values in tests:

```typescript
// ❌ Bad - non-existent enum value
{ type: 'ON_SUCCESS', action: ConditionalActionType.EMAIL }

// ✅ Good - correct enum value
{ type: 'ON_SUCCESS', action: ConditionalActionType.SEND_MESSAGE }
```

### Const Assertions

Use const assertions for better type inference:

```typescript
const ToolType = {
  SLACK: "SLACK",
  EMAIL: "EMAIL",
  DISCORD: "DISCORD",
  WEBHOOK: "WEBHOOK",
  HTTP: "HTTP",
} as const;

type ToolTypeValue = (typeof ToolType)[keyof typeof ToolType];
```

## Error Testing

### Typed Error Creation

Create type-safe error utilities:

```typescript
interface TrpcError {
  code: string;
  message: string;
  data: {
    code: string;
    httpStatus: number;
  };
}

export const createTrpcError = (code: string, message: string): TrpcError => ({
  code,
  message,
  data: {
    code,
    httpStatus: code === "UNAUTHORIZED" ? 401 : 400,
  },
});
```

## Performance Testing

### Typed Performance Utilities

```typescript
export const measureApiResponseTime = async (
  apiCall: () => Promise<any>,
): Promise<number> => {
  const startTime = performance.now();
  await apiCall();
  const endTime = performance.now();
  return endTime - startTime;
};
```

## Best Practices

### 1. Interface over Type for Complex Structures

```typescript
// ✅ Good - interface for objects
interface MockTool {
  id: number;
  name: string;
  // ...
}

// ✅ Good - type for unions
type ToolTypeValue = "EMAIL" | "SLACK" | "DISCORD";
```

### 2. Avoid Circular Type References

```typescript
// ❌ Bad - circular reference
type MockHandlers = Record<string, MockHandler | MockHandlers>;

// ✅ Good - use Record<string, any> for nested structures
type MockHandlers = Record<string, MockHandler | Record<string, any>>;
```

### 3. Remove Unused Imports

Keep imports clean to avoid linting errors:

```typescript
// Remove unused imports like RenderResult, UserEvent if not used
import { render, screen, waitFor } from "@testing-library/react";
```

### 4. Explicit Generic Constraints

```typescript
// ✅ Good - explicit generic typing
export const renderHookWithTrpc = <T>(
  hook: () => T,
  mockHandlers: MockHandlers = {},
): ReturnType<typeof renderHook<T>> => {
  // Implementation
};
```

## Common Pitfalls

### 1. Using `any` in Tests

Avoid `any` types even in tests. Use proper interfaces or `unknown` when needed.

### 2. Missing Return Types

Always specify return types for functions, especially in mocks.

### 3. Incorrect Enum Values

Double-check enum values match the actual implementation.

### 4. Untyped Event Handlers

Always type event handlers in component mocks.

## Migration Strategy

1. **Start with Test Utilities** - Fix core testing utilities first
2. **Component Tests** - Update component test mocks with proper types
3. **Integration Tests** - Ensure end-to-end type safety
4. **Mock Cleanup** - Remove any remaining `any` types from mocks
5. **Documentation** - Keep this guide updated with new patterns

By following these guidelines, we ensure our testing infrastructure maintains the same type safety standards as our production code, leading to more reliable tests and better developer experience.
