# Cronium Platform Overview

**Review Date:** October 9, 2025  
**Reviewer:** Claude Code

## Executive Summary

Cronium is a self-hosted automation platform designed for scheduling and executing scripts across local containers and remote servers. The system employs a distributed architecture with a Next.js web application, Go-based orchestration services, and containerized execution environments. The platform supports workflows, conditional actions, real-time logging, and integrations with external services through a plugin system.

## Architecture Overview

### Core Components

#### 1. **Cronium App** (`apps/cronium-app`)

- **Technology:** Next.js 15 (App Router), TypeScript, TailwindCSS 4
- **Purpose:** Primary web interface and API server
- **Key Features:**
  - User authentication and role-based access control (Next-Auth)
  - Event creation, scheduling, and management
  - Workflow visual builder with canvas interface
  - Real-time WebSocket communication for execution monitoring
  - Tool integration management (plugins for Slack, Discord, Email, etc.)
  - Dashboard with activity monitoring and statistics

#### 2. **Orchestrator** (`apps/orchestrator`)

- **Technology:** Go
- **Purpose:** Job queue processing and execution coordination
- **Responsibilities:**
  - Polls database job queue for pending work
  - Routes jobs to appropriate executors (container or SSH)
  - Manages execution lifecycle and status updates
  - Handles retries and failure recovery
  - Provides real-time execution updates via API callbacks

#### 3. **Runtime Service** (`apps/runtime`)

- **Technology:** Go
- **Purpose:** Helper API for script runtime functions
- **Features:**
  - Provides runtime helpers (`cronium.input()`, `cronium.output()`, `cronium.log()`, etc.)
  - Serves signed runner binaries for SSH deployment
  - JWT-based authentication for secure helper access
  - API mode with SSH tunneling for remote execution

### Supporting Services

- **Database:** PostgreSQL (Neon compatible)
- **Real-time Cache:** Valkey/Redis (for WebSocket and job queue coordination)
- **Docker:** Container runtime for isolated script execution

## Data Model

### Core Entities

#### Events

- Scheduled or manual scripts (Bash, Python, Node.js) and HTTP requests
- Configuration: schedule (cron/interval), timeout, retry count, resource limits
- Run location: LOCAL (containerized) or REMOTE (SSH)
- Status lifecycle: DRAFT → ACTIVE → PAUSED → ARCHIVED
- Supports conditional actions (on success/failure/always/condition)
- Can be standalone or part of workflows

#### Jobs

- Queued execution tasks created from events
- Status flow: QUEUED → CLAIMED → RUNNING → COMPLETED/FAILED/CANCELLED
- Priority-based queue (LOW, NORMAL, HIGH, CRITICAL)
- Atomic claiming mechanism prevents duplicate processing
- Payload contains script, environment, resources, and execution context

#### Executions

- Individual execution records for jobs
- Tracks per-server execution in multi-server scenarios
- Records detailed timing: setup, execution, cleanup phases
- Stores output, error, exit code, and metadata
- Format: `exec_{jobId}_{timestamp}`

#### Logs

- High-level execution records for user-facing activity
- Aggregates multi-server execution results
- Status: PENDING, RUNNING, SUCCESS, FAILURE, TIMEOUT, PARTIAL
- Links to jobs and executions via foreign keys
- Supports workflow execution tracking

#### Workflows

- Multi-event orchestration with visual canvas
- Nodes represent events; edges define execution flow
- Connection types: ALWAYS, ON_SUCCESS, ON_FAILURE, ON_CONDITION
- Execution tracking with detailed step-by-step logging
- Can override server selection across all events

#### Servers

- SSH connection targets for remote execution
- Authentication via SSH key or password (encrypted)
- Soft delete with 30-day retention period
- Health monitoring and online status tracking

## Execution Flow

### 1. Event Triggering

**Scheduled Events:**

```
User creates event → Scheduler (Node.js) → Job created in database
                                         ↓
                          Job queue (PostgreSQL table)
```

**Manual/Workflow Events:**

```
User/Workflow triggers → Job Service → Job created → Queue
```

### 2. Job Processing

```
Orchestrator (Go) polls queue
    ↓
Atomically claims job (prevents duplication)
    ↓
Determines execution type:
    ├─ Container Executor (LOCAL)
    └─ SSH Executor (REMOTE - single or multi-server)
```

### 3. Container Execution (LOCAL)

```
1. SETUP PHASE:
   - Create isolated Docker network
   - Start runtime sidecar (provides helper API)
   - Pull/verify container image
   - Create container with resource limits

2. EXECUTION PHASE:
   - Start container with script
   - Stream logs in real-time (stdout/stderr)
   - Monitor for completion/timeout

3. CLEANUP PHASE:
   - Collect final output
   - Stop and remove container
   - Stop sidecar and remove network
   - Update execution record with results
```

**Timing Breakdown:**

- Network creation time
- Sidecar startup time
- Image pull time (cached after first pull)
- Container creation time
- Actual script execution time
- Total duration

**Resource Isolation:**

- CPU limits (NanoCPUs)
- Memory limits (with OOM detection)
- PIDs limits
- Disk limits (tmpfs mounts)
- Network isolation per job
- Security: no-new-privileges, seccomp profiles

### 4. SSH Execution (REMOTE)

```
1. SETUP PHASE:
   - Get SSH connection from pool (with timeout/retry)
   - Deploy runner binary to server (cached per version)
   - Create payload package (tar.gz with script + manifest)
   - Transfer payload to server
   - Optionally establish SSH tunnel for helper API

2. EXECUTION PHASE:
   - Execute runner with payload on remote server
   - Stream output back over SSH
   - Monitor for completion/timeout

3. CLEANUP PHASE:
   - Collect final output
   - Remove payload from server
   - Return SSH connection to pool
   - Update execution record with results
```

**Multi-Server Execution:**

- Parallel execution across multiple servers
- Individual execution records per server
- Aggregated status in parent log
- Partial success handling (exit code 100 + failed server count)
- Independent failure isolation

**Runner Binary:**

- Compiled Go binary deployed to `/tmp/cronium-runner-{version}`
- Cached on servers to avoid repeated deployment
- Checksums verified for integrity
- Executes payload with helper functions
- Two modes:
  - **Bundled mode:** Helpers compiled into runner
  - **API mode:** Helpers via HTTP to runtime service (via SSH tunnel)

### 5. Status Updates

```
Executor → API Client → Database updates
                     ↓
            WebSocket Broadcaster
                     ↓
          Connected UI clients receive real-time updates
```

## Workflow Execution

Workflows execute events as a directed acyclic graph (DAG) with support for:

### Execution Flow

1. User triggers workflow (manual, schedule, or webhook)
2. Workflow executor creates execution record
3. Identifies start nodes (nodes with no incoming connections)
4. Executes nodes based on connection types:
   - **ALWAYS:** Execute next node regardless of result
   - **ON_SUCCESS:** Execute only if previous succeeded (exit code 0)
   - **ON_FAILURE:** Execute only if previous failed (exit code ≠ 0)
   - **ON_CONDITION:** Execute based on script output condition

### Features

- **Visual Canvas:** ReactFlow-based drag-and-drop workflow builder
- **Conditional Branching:** Dynamic path selection based on results
- **Data Passing:** `cronium.input()` and `cronium.output()` for inter-event data
- **Progress Tracking:** Real-time status updates for each node
- **Execution History:** Detailed logs per workflow run
- **Error Handling:** Graceful failure with partial execution tracking

### Workflow Logs

- Aggregated view of all event executions in workflow
- Step-by-step execution order
- Duration tracking for entire workflow
- Success/failure counts per workflow run

## Logging System

### Multi-Layered Logging Architecture

#### 1. **Logs Table** (High-Level)

- User-facing execution records
- One log per event execution
- Aggregates multi-server results
- Status values: PENDING, RUNNING, SUCCESS, FAILURE, TIMEOUT, PARTIAL
- Contains: output, error, duration, timing breakdowns

#### 2. **Executions Table** (Low-Level)

- Technical execution details
- One per job execution (multiple for multi-server jobs)
- Tracks individual server execution
- Detailed phase timing: setup, execution, cleanup
- Contains: exit code, server info, metadata

#### 3. **Workflow Logs** (Orchestration Level)

- Workflow-level execution tracking
- Contains: workflow status, total duration, event counts
- Links to individual event logs via log.workflowId

### Log Aggregation

**Single Server:**

```
Event → Job → Execution → Log
```

**Multi-Server:**

```
Event → Job → Multiple Executions (one per server) → Single Log (aggregated)
```

**Workflow:**

```
Workflow → Multiple Events → Multiple Jobs → Multiple Executions → Multiple Logs
                                                                    ↓
                                            Workflow Execution Record
```

### Timing Metrics

- **Setup Duration:** Container/SSH connection setup time
- **Execution Duration:** Actual script runtime
- **Cleanup Duration:** Resource cleanup time (future)
- **Total Duration:** End-to-end execution time

## Tool Plugins Architecture

### Plugin System

- **Registry-based:** `ToolPluginRegistry` manages all plugins
- **Type-safe:** Zod schemas for credential and parameter validation
- **Modular:** Each plugin self-contained with own UI components

### Plugin Structure

```
Plugin
├── Metadata (id, name, description, icon, category)
├── Credential Schema (Zod validation)
├── UI Components
│   ├── CredentialForm (for adding/editing credentials)
│   ├── CredentialDisplay (for viewing saved credentials)
│   └── TemplateManager (optional, for action templates)
├── Actions (array of executable actions)
│   ├── Input/Output schemas
│   ├── Execute function
│   ├── Visual form config
│   └── Conditional action support
└── API Routes (tRPC endpoints for plugin operations)
```

### Built-in Plugins

1. **Slack** - Send messages, post to channels
2. **Discord** - Send webhooks and messages
3. **Email** - SMTP email sending
4. **Microsoft Teams** - Send messages and adaptive cards
5. **Google Sheets** - Read/write spreadsheet data
6. **Notion** - Create pages, update databases
7. **Trello** - Create cards, manage boards

### Conditional Actions

- Plugins can designate actions for conditional use
- Mapping between conditional fields and action parameters
- Custom UI for conditional action configuration
- Executed automatically based on event results

### Tool Action Features

- **Test Mode:** Generate mock data for testing
- **Real-time Preview:** Live parameter validation
- **Batch Support:** Execute multiple actions together
- **Webhook Support:** Trigger from external events
- **Error Recovery:** Retry logic and fallback handling

## Security Architecture

### Credential Encryption

#### Server-Side (AES-256-GCM)

- **Master Key:** 256-bit key from `ENCRYPTION_KEY` environment variable
- **Encrypted Fields:**
  - `servers.sshKey`, `servers.password`
  - `users.password` (bcrypt hashed)
  - `envVars.value`
  - `apiTokens.token`
  - `toolCredentials.credentials` (JSON encrypted as blob)
- **Storage Format:** Base64-encoded (IV + encrypted + auth tag)
- **Authentication:** Additional authenticated data (AAD) prevents tampering

#### Client-Side (PBKDF2 + AES-GCM)

- **Key Derivation:** PBKDF2 with 100,000 iterations
- **Use Case:** Sensitive data encrypted before transmission
- **Format:** Base64-encoded (salt + IV + encrypted)

### Authentication & Authorization

- **Next-Auth:** Session-based authentication
- **Roles:** USER, ADMIN, VIEWER (with custom permissions)
- **JWT Tokens:** For API authentication (orchestrator ↔ app)
- **API Tokens:** User-generated for programmatic access
- **Password Reset:** Secure token-based flow with expiry

### Execution Security

- **Container Isolation:**
  - Non-root user execution
  - Resource limits (CPU, memory, PIDs)
  - Network isolation per job
  - No-new-privileges flag
  - Seccomp profiles
  - Read-only root filesystem (future)
- **SSH Security:**
  - SSH key authentication preferred
  - Connection pooling with health checks
  - Runner binary checksum verification
  - JWT tokens for helper API access
  - Automatic payload cleanup

### Data Security

- **Encryption at Rest:** All sensitive fields encrypted in database
- **Encryption in Transit:** HTTPS for web traffic, SSH for remote execution
- **Secrets Management:** Environment variables never logged
- **Access Control:** Row-level security for multi-tenant isolation

## App vs. Orchestrator Responsibilities

### Cronium App Responsibilities

- **User Interface:** All web UI, forms, dashboards
- **API Server:** tRPC and REST endpoints for frontend
- **Authentication:** User login, session management, permissions
- **Job Creation:** Creates jobs in queue from events/workflows
- **Scheduling:** Node-schedule manages event triggers
- **Database Management:** CRUD operations for all entities
- **WebSocket Server:** Real-time updates to connected clients
- **Tool Management:** Plugin registration, credential storage
- **Workflow Management:** Visual builder, execution orchestration

### Orchestrator Responsibilities

- **Job Processing:** Polls queue, claims jobs atomically
- **Execution Routing:** Routes jobs to container or SSH executor
- **Container Management:** Docker API interaction, resource management
- **SSH Management:** Connection pooling, runner deployment, remote execution
- **Payload Management:** Creates, distributes, and cleans up payloads
- **Status Reporting:** Updates job/execution/log status in database
- **Real-time Streaming:** Logs execution output back to app
- **Health Monitoring:** Container and SSH connection health checks
- **Cleanup:** Resource cleanup after execution

### Communication Flow

```
App (Next.js)                  Orchestrator (Go)
     │                               │
     ├─ Creates Job ────────────────→ Database Queue
     │                               │
     │                          Polls Queue ←─┘
     │                               │
     │                          Claims Job
     │                               │
     │                          Executes Job
     │                               │
     │                               ├─ Container Executor
     │                               └─ SSH Executor
     │                                      │
     │ ←─── Status Updates via API ────────┤
     │                                      │
     │ ←─── Final Results ──────────────────┘
     │
     └─ Broadcasts via WebSocket → UI Clients
```

## Key Features & Capabilities

### Event Execution

- **Script Types:** Bash, Python, Node.js
- **HTTP Requests:** GET, POST, PUT, DELETE, PATCH with headers/body
- **Tool Actions:** Execute plugin actions as events
- **Scheduling:** Cron, intervals (seconds/minutes/hours/days)
- **Manual Execution:** On-demand triggers
- **Input/Output:** Pass data between events via `cronium` helpers
- **Environment Variables:** Per-event environment configuration
- **Timeout Control:** Configurable timeouts with automatic termination
- **Retry Logic:** Automatic retry on failure with exponential backoff
- **Execution Limits:** Max execution count with counter reset

### Workflow Capabilities

- **Visual Builder:** Drag-and-drop canvas with ReactFlow
- **Conditional Logic:** Dynamic branching based on results
- **Data Flow:** Inter-event data passing
- **Parallel Execution:** Multiple events can run concurrently (future)
- **Workflow Variables:** Shared state across workflow events
- **Error Handling:** Continue on error, fail fast, or custom handling
- **Schedule/Webhook/Manual:** Multiple trigger types

### Runtime Helpers

Available in scripts via global `cronium` object:

- **`cronium.input()`** - Get input data passed to event
- **`cronium.output(value)`** - Return data to next event
- **`cronium.log(message, level)`** - Structured logging
- **`cronium.getVariable(key)`** - Get user/workflow variable
- **`cronium.setVariable(key, value)`** - Set variable for future use
- **`cronium.event()`** - Get current event metadata
- **`cronium.sleep(ms)`** - Delay execution
- **`cronium.fetch(url, options)`** - HTTP requests with auth

### Server Management

- **SSH Connections:** Pooled connections with health monitoring
- **Multi-Server:** Execute same script across multiple servers
- **Server Groups:** Organize servers by environment/purpose
- **Health Checks:** Automatic online/offline detection
- **Credentials:** SSH keys or passwords (encrypted)
- **Soft Delete:** 30-day retention before permanent deletion
- **Notifications:** Email alerts for deletion warnings

### Real-time Features

- **WebSocket Updates:** Live execution progress
- **Log Streaming:** Real-time stdout/stderr output
- **Status Broadcasts:** Job state changes pushed to UI
- **Multi-client Sync:** All connected clients receive updates
- **Retry Mechanism:** Automatic reconnection on disconnect

### Dashboard & Analytics

- **Activity Feed:** Recent executions with status
- **Statistics:** Success/failure rates, execution counts
- **Performance Metrics:** Average duration, timing breakdowns
- **Filters:** By event, workflow, server, date, status
- **Charts:** Visual representation of execution trends (future)

## Technical Highlights

### Performance Optimizations

- **Connection Pooling:** Reuse SSH connections across jobs
- **Runner Caching:** Deploy runner binary once per server version
- **Image Caching:** Docker images cached locally after first pull
- **Database Indexing:** Optimized queries for job queue polling
- **Batch Operations:** Bulk status updates for multi-server executions

### Reliability Features

- **Atomic Job Claiming:** Prevents duplicate processing
- **Job Retries:** Configurable retry logic with backoff
- **Circuit Breakers:** SSH connection failure detection
- **Health Monitoring:** Continuous health checks for services
- **Graceful Degradation:** Fallback to bundled helpers if API fails
- **Timeout Handling:** Proper cleanup on execution timeout
- **OOM Detection:** Memory limit enforcement with detection

### Observability

- **Structured Logging:** Consistent log format across services
- **Execution Metadata:** Detailed timing and resource usage
- **Error Context:** Rich error details with stack traces
- **Audit Trails:** Tool usage and credential access logs
- **WebSocket Diagnostics:** Connection state monitoring

### Developer Experience

- **Type Safety:** End-to-end TypeScript types
- **Hot Reload:** Fast development iteration
- **Docker Compose:** One-command local development
- **Monorepo:** Shared code and consistent tooling
- **Migration Scripts:** Database schema versioning
- **Seed Data:** Quick development database setup

## Deployment Architecture

### Production Setup

```
┌─────────────────────────────────────────────────┐
│              Reverse Proxy (Nginx)              │
│                 (TLS Termination)               │
└─────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌────▼────┐ ┌───────▼──────┐
│              │ │         │ │              │
│ Cronium App  │ │  Redis  │ │ Orchestrator │
│  (Next.js)   │ │ (Valkey)│ │     (Go)     │
│              │ │         │ │              │
└──────┬───────┘ └─────────┘ └──────┬───────┘
       │                             │
       │    ┌────────────────┐       │
       └────►   PostgreSQL   ◄───────┘
            │   (Database)   │
            └────────────────┘
```

### Container Registry

- Runner binaries built per architecture (amd64, arm64)
- Container images for each script type (bash, python, node)
- Custom helper library images
- Versioned releases with semantic versioning

### Environment Variables

See `ENVIRONMENT_VARIABLES.md` for complete reference. Key variables:

- `DATABASE_URL` - PostgreSQL connection
- `ENCRYPTION_KEY` - Master encryption key
- `NEXTAUTH_SECRET` - Auth session encryption
- `API_TOKEN` - Orchestrator ↔ App authentication
- `RUNTIME_HOST/PORT` - Runtime service location
- `JWT_SECRET` - Runner authentication

## Future Enhancements

### Planned Features

- **Parallel Workflow Execution:** Execute workflow branches concurrently
- **Advanced Scheduling:** Dependencies, SLA tracking, calendar scheduling
- **Enhanced Monitoring:** Metrics dashboard, alerting, APM integration
- **Plugin Marketplace:** Community plugins, OAuth integrations
- **Workflow Templates:** Pre-built workflow templates for common tasks
- **Advanced Retry Logic:** Custom retry strategies, circuit breakers
- **Resource Quotas:** User/team-level resource limits
- **Audit Logging:** Comprehensive audit trail for compliance
- **API Rate Limiting:** Protect against abuse
- **Webhook Management:** Inbound webhook handling for event triggers

### Technical Debt

- Migrate to new action builder for all conditional actions
- Complete test coverage for critical paths
- Performance benchmarks and load testing
- Documentation for all API endpoints
- E2E tests for workflow execution
- Monitoring and alerting infrastructure

## Conclusion

Cronium is a well-architected, production-ready automation platform with a clear separation of concerns between the web application and execution orchestration. The system handles complex execution scenarios (containerized, SSH, multi-server, workflows) with robust error handling, real-time monitoring, and comprehensive security. The plugin architecture enables extensibility, while the monorepo structure facilitates code sharing and consistent development practices.

The platform is designed for self-hosting with reasonable defaults and production-ready features like encryption, authentication, job queuing, and real-time updates. The distributed architecture allows for horizontal scaling of the orchestrator component while maintaining a simple deployment model for small to medium workloads.
