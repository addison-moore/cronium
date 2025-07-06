# 🤖 Cronium Project Context

This document provides comprehensive context and architectural guidance for AI assistants working with the Cronium project.

---

## 📌 Project Overview

**Cronium** is a self-hosted, open-source platform for writing, scheduling, and executing scripts and HTTP requests as part of customizable, monitorable workflows.

Users can create workflows with multiple "events" (bash, Node.js, Python, HTTP calls), pass data between events, and configure conditional logic for branching execution. The platform supports scheduling via UI and cron syntax, as well as multi-server remote execution.

---

## 🧱 Current Technology Stack

- **Frontend:** Next.js 15 (App Router), TypeScript, TailwindCSS 4
- **Backend:** tRPC (type-safe APIs), Next.js API routes (legacy), Drizzle ORM
- **Database:** PostgreSQL/Neon with Drizzle ORM
- **Authentication:** Next-Auth with email/password, role-based permissions
- **Real-time:** Socket.IO/WebSockets, xterm.js for terminal integration
- **Forms:** React Hook Form + Zod validation (migration in progress)
- **Testing:** Jest with comprehensive tRPC testing infrastructure

---

## 🔑 Core Concepts

### Events

Scheduled scripts (bash, Node.js, Python) or HTTP requests that can be executed on local or remote servers.

### Workflows

Multi-step event chains with conditional logic and data passing between events.

### Servers

Remote execution targets accessed via SSH for distributed script execution.

### Variables

Global and user-defined runtime variables for dynamic script configuration.

### Tools & Integrations

Plugin system supporting Slack, Discord, Email, and webhook integrations.

### Runtime Helpers

- `cronium.input()` / `cronium.output()` - Pass data between events
- `cronium.getVariable(name)` / `cronium.setVariable(name, value)` - Variable management
- `cronium.event()` - Access current event metadata

---

## 🏗️ Architecture Status

### Migration Progress (100% Complete)

The project has successfully completed a major migration from REST APIs to type-safe tRPC infrastructure:

- **✅ tRPC Backend:** 16 routers covering 150+ endpoints (100% complete)
- **✅ Frontend Components:** 26+ tRPC components (100% complete)
- **✅ Live Application:** All critical workflows using tRPC (100% complete)
- **✅ Code Cleanup:** Component architecture standardized

### Type Safety Initiative

Comprehensive type safety improvements are ongoing:

- **Target:** Eliminate 6,172+ TypeScript errors (77.6% unsafe `any` types)
- **Progress:** 5 phases implemented with significant error reduction
- **Status:** Foundation, core business logic, and UI components largely completed

---

## 🔐 Authentication & Security

- **Current Implementation:** Next-Auth with email/password
- **User Roles:** Admin, User, Viewer with comprehensive permission system
- **Admin Features:** User management, invitation system, role assignment
- **Security Goals:**
  - Script execution containerization (Docker/LXC planned)
  - API token management
  - SSH key management for remote servers

---

## 🗂️ Key Directories

```
src/
├── app/                    # Next.js App Router pages and API routes
├── components/             # React components (organized by feature)
├── lib/                    # Core business logic and utilities
├── server/                 # tRPC setup and server-side code
├── shared/                 # Database schema and shared types
├── runtime-helpers/        # Helper scripts for event execution
└── __tests__/              # Comprehensive test suite
```

---

## 🚀 Development Commands

```bash
# Development
pnpm dev              # Start Next.js dev server on port 5001
pnpm dev:socket       # Start WebSocket server

# Building & Testing
pnpm build            # Build Next.js application
pnpm test             # Run Jest tests
pnpm lint             # Run Next.js linter

# Database Operations
pnpm db:push          # Push Drizzle schema to database
pnpm db:studio        # Open Drizzle Kit studio
pnpm db:generate      # Generate Drizzle migrations
```

---

## 🎯 Current Priorities

### 1. **Type Safety Completion**

- Continue systematic elimination of `any` types
- Focus on test files and integration patterns
- Implement advanced TypeScript patterns

### 2. **Component Architecture Cleanup**

- Remove redundant REST components (moved to backups)
- Standardize tRPC component naming conventions
- Clean up import statements and function exports

### 3. **Security Enhancement**

- Implement containerized script execution
- Complete API token management system
- Enhance role-based access controls

### 4. **Form System Modernization**

- Complete migration to React Hook Form + Zod
- Standardize validation patterns
- Implement comprehensive error handling

---

## 🧠 Implementation Guidelines

### tRPC Patterns

```typescript
// Standard query pattern
const { data, isLoading, error } = trpc.events.getAll.useQuery({
  limit: 10,
  offset: 0,
});

// Standard mutation pattern
const createEvent = trpc.events.create.useMutation({
  onSuccess: () => toast.success("Event created"),
  onError: (error) => toast.error(error.message),
});
```

### Form Patterns

```typescript
// React Hook Form + Zod pattern
const form = useForm<CreateEventInput>({
  resolver: zodResolver(createEventSchema),
  defaultValues: {
    /* ... */
  },
});
```

### Error Handling

- Use tRPC error codes (UNAUTHORIZED, FORBIDDEN, NOT_FOUND)
- Implement consistent toast notifications
- Provide user-friendly error messages

---

## 🔧 Testing Strategy

### Test Infrastructure

- **tRPC Testing:** Custom `renderWithTrpc` utilities
- **Mock Handlers:** Comprehensive tRPC mock patterns
- **Performance:** API response time measurement
- **Integration:** End-to-end workflow testing

### Testing Priorities

1. Critical business logic (events, workflows, authentication)
2. User interface components and interactions
3. Integration with external services
4. Performance and error handling

---

## 📊 Key Metrics & Goals

### Development Metrics

- **Type Safety:** Target 90%+ reduction in TypeScript errors
- **Test Coverage:** Maintain >90% coverage for critical paths
- **Performance:** <200ms for simple queries, <500ms for complex operations
- **Bundle Size:** Monitor and optimize client bundle size

### User Experience Goals

- **Reliability:** Zero data loss, comprehensive error recovery
- **Performance:** Fast loading times, responsive interactions
- **Security:** Proper access controls, secure script execution
- **Usability:** Intuitive workflows, clear error messages

---

## 🚨 Important Considerations

### Script Execution Security

- **Current State:** Scripts execute directly on host (security risk)
- **Migration Goal:** Container isolation (Docker/LXC)
- **User Permissions:** Role-based execution controls

### Data Management

- **Database:** PostgreSQL with Drizzle ORM
- **Migrations:** Use `pnpm db:generate` and `pnpm db:push`
- **Backup:** Consider data backup strategies for production

### External Integrations

- **API Tokens:** Encrypted storage for third-party credentials
- **Webhooks:** Public endpoints for external webhook consumption
- **SSH:** Secure key management for remote server access

---

## 🔗 Related Documentation

- **[AUTH.md](AUTH.md)** - Authentication implementation details
- **[EXECUTION.md](EXECUTION.md)** - Script execution and containerization plans
- **[tRPC_API.md](tRPC_API.md)** - tRPC patterns and conventions
- **[TYPE_SAFETY_GUIDELINES.md](TYPE_SAFETY_GUIDELINES.md)** - TypeScript best practices
- **[plans/Type_Safety.md](../plans/Type_Safety.md)** - Comprehensive type safety improvement plan
- **[plans/completed/tRPC_transition.md](../plans/completed/tRPC_transition.md)** - Complete tRPC migration documentation

---

## 🧭 AI Assistant Guidelines

When working with this codebase:

1. **Follow tRPC Patterns:** Use established tRPC query/mutation patterns
2. **Maintain Type Safety:** Avoid `any` types, use proper TypeScript patterns
3. **Preserve UI/UX:** Maintain existing styling and user experience
4. **Test Comprehensively:** Use tRPC testing utilities for new components
5. **Document Changes:** Update Changelog.md with all modifications
6. **Security First:** Consider security implications of script execution
7. **Performance Aware:** Monitor bundle size and response times

### Code Style Preferences

- **Forms:** Use React Hook Form + Zod for new forms
- **APIs:** Use tRPC for all new endpoints
- **Components:** Preserve existing styling and layout
- **Testing:** Include comprehensive test coverage
- **Documentation:** Update relevant documentation files

This project prioritizes type safety, security, and maintainability while providing a powerful platform for automated script execution and workflow management.
