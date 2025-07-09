# tRPC Configuration Modernization Plan

## Current State Analysis

After reviewing the existing tRPC configuration files, I've identified several areas that need improvement to align with 2025 best practices for Next.js 15 App Router applications.

### Files Reviewed

- `src/trpc/server.ts` - Server-side caller
- `src/trpc/react.tsx` - Client-side React provider
- `src/server/api/trpc.ts` - Core tRPC configuration
- `src/server/api/root.ts` - Root router setup

## Issues Identified

### 🔴 Critical Issues

1. **Inconsistent Context Creation** (`src/server/api/trpc.ts:50-96`)
   - Complex session handling with fallback logic for Pages Router compatibility
   - Console logging in production code
   - Type assertion hacks for ServerResponse compatibility
   - No database connection in context (missing from best practices)

2. **Missing Database Context**
   - Context only includes session, missing database instance
   - Violates modern tRPC patterns where db should be available in all procedures

3. **Deprecated HTTP Batch Stream Link** (`src/trpc/react.tsx:36`)
   - Using `unstable_httpBatchStreamLink` which is marked as unstable
   - Should use stable `httpBatchLink` for production applications

### 🟡 Moderate Issues

4. **Improper Error Formatting** (`src/server/api/trpc.ts:107-118`)
   - ZodError handling uses string comparison instead of proper instanceof check
   - Missing proper error formatting for production vs development

5. **Missing Query Client Configuration** (`src/trpc/react.tsx:11`)
   - Basic QueryClient setup without optimized defaults
   - No stale time, cache time, or retry configurations

6. **Inconsistent Base URL Logic** (`src/trpc/react.tsx:58-62`)
   - Hardcoded port fallback to 3000 instead of reading from CLAUDE.md (port 5001)
   - Missing proper environment variable handling

### 🟢 Minor Issues

7. **Missing Type Exports** (`src/server/api/root.ts`)
   - Could export `RouterInputs` type helper for input type inference
   - Missing some utility types that would be helpful for client-side development

8. **Server-Side Context Caching** (`src/trpc/server.ts:13`)
   - Using React cache but could be optimized for better performance
   - Missing proper context cleanup

## Improvement Plan

### Phase 1: Critical Fixes (Priority: High)

#### 1.1 Modernize Core tRPC Configuration

**File**: `src/server/api/trpc.ts`

**Changes**:

- Simplify context creation for App Router only (remove Pages Router compatibility)
- Add database connection to context
- Remove console.log statements
- Implement proper ZodError handling
- Add proper type safety for context

**Before**:

```typescript
// Complex session handling with fallbacks
const createTRPCContext = async (opts: CreateNextContextOptions) => {
  // 50+ lines of complex logic
};
```

**After**:

```typescript
const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await getServerSession(authOptions);
  return {
    session,
    db, // Add database connection
    headers: opts.headers,
  };
};
```

#### 1.2 Update Client Provider

**File**: `src/trpc/react.tsx`

**Changes**:

- Replace `unstable_httpBatchStreamLink` with stable `httpBatchLink`
- Add proper QueryClient configuration
- Fix base URL to use correct port (5001)
- Add error boundary integration

#### 1.3 Add Database to Context

**Files**: `src/server/api/trpc.ts`, all router files

**Changes**:

- Import and add database instance to context
- Update all procedures to use `ctx.db` instead of importing db separately
- Ensure type safety for database operations

### Phase 2: Performance & DX Improvements (Priority: Medium)

#### 2.1 Optimize Query Client Configuration

**File**: `src/trpc/react.tsx`

**Changes**:

- Add optimized default options (staleTime, cacheTime, retry logic)
- Implement proper error handling
- Add React Query DevTools integration for development

#### 2.2 Enhanced Error Handling

**File**: `src/server/api/trpc.ts`

**Changes**:

- Implement production-safe error formatter
- Add proper ZodError parsing with flattened errors
- Add error codes mapping for better client-side handling

#### 2.3 Type Safety Improvements

**Files**: `src/server/api/root.ts`, `src/trpc/react.tsx`

**Changes**:

- Export `RouterInputs` type helper
- Add proper type inference for nested router outputs
- Implement better type safety for middleware

### Phase 3: Advanced Features (Priority: Low)

#### 3.1 Server-Side Optimizations

**File**: `src/trpc/server.ts`

**Changes**:

- Implement proper context memoization
- Add request deduplication
- Optimize for App Router performance patterns

#### 3.2 Development Experience

**Files**: Multiple

**Changes**:

- Add tRPC DevTools integration
- Implement proper logging middleware for development
- Add request/response timing middleware

## Implementation Timeline

### Week 1: Critical Fixes ✅ COMPLETED

- [x] Modernize core tRPC configuration
- [x] Replace unstable HTTP batch stream link
- [x] Add database to context
- [x] Remove console.log statements
- [x] Fix base URL port configuration

### Week 2: Performance Improvements ✅ COMPLETED

- [x] Optimize QueryClient configuration with advanced caching, retry logic, and garbage collection
- [x] Enhance error handling with production vs development modes
- [x] Improve type safety with RouterInputs, utility types, and context helpers
- [x] Add React Query DevTools integration for development
- [x] Implement enhanced logging middleware with structured output

### Week 3: Advanced Features ✅ COMPLETED

- [x] Server-side context optimizations with React cache deduplication
- [x] Advanced middleware suite (timing, caching, rate limiting, transactions)
- [x] App Router performance patterns and hydration utilities
- [x] Comprehensive testing utilities for server and client
- [x] Advanced query configuration patterns and middleware combinations
- [x] Performance monitoring and cache management tools
- [x] Complete documentation and migration guide

## Breaking Changes

### Context Structure Changes

- Database will be added to context, requiring updates to procedures that import db directly
- Session handling will be simplified, removing Pages Router compatibility

### Client Provider Changes

- QueryClient configuration will change default behavior
- Base URL logic will be updated to use correct port

## Migration Strategy

1. **Backward Compatibility**: Maintain current API surface during transition
2. **Gradual Migration**: Update routers one by one to use new context structure
3. **Testing**: Comprehensive testing of each phase before moving to next
4. **Documentation**: Update internal documentation and team guidelines

## Expected Benefits

### Performance

- Faster server-side rendering with optimized context creation
- Better client-side caching with optimized QueryClient
- Reduced bundle size with stable API links

### Developer Experience

- Better type safety with database in context
- Cleaner error handling and debugging
- Improved development tools integration

### Maintainability

- Simplified configuration aligned with Next.js 15 patterns
- Better separation of concerns
- Easier testing and mocking

## Success Metrics ✅ ALL ACHIEVED

- [x] Zero console.log statements in production builds
- [x] All procedures have access to `ctx.db` through enhanced context
- [x] Client uses stable tRPC links only (httpBatchLink)
- [x] Error handling provides actionable feedback with type safety
- [x] Type safety significantly improved with comprehensive utilities
- [x] Performance monitoring and optimization tools implemented
- [x] Advanced caching and middleware patterns available
- [x] Complete testing utilities for both server and client
- [x] Comprehensive documentation and migration guides

## Risk Assessment

**Low Risk**: Configuration changes are mostly internal and won't affect API surface
**Medium Risk**: Context changes may require updates to existing procedures
**Mitigation**: Phased rollout with comprehensive testing at each stage

---

_This plan aligns with the tRPC best practices documented in `docs/tRPC_API_GUIDE.md` and follows the project conventions outlined in `CLAUDE.md`._
