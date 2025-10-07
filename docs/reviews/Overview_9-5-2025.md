# Cronium Application Overview

_Date: September 5, 2025_

## Executive Summary

Cronium is a self-hosted automation platform that enables users to schedule and execute scripts, HTTP requests, and workflow automations. It provides both local containerized execution and remote SSH-based execution, with a robust job queue system, real-time monitoring, and extensive integration capabilities through tool plugins.

## Architecture Overview

### Core Components

1. **Next.js Web Application** (`apps/cronium-app`)
   - Next.js 15 with App Router
   - tRPC for type-safe APIs
   - WebSocket support for real-time updates
   - Role-based authentication via NextAuth

2. **Go Orchestrator Service** (`apps/orchestrator`)
   - Job queue polling and management
   - Container and SSH execution engines
   - Payload management and distribution
   - Connection pooling and circuit breakers

3. **Go Runtime Service** (`apps/runtime`)
   - Provides signed runner binaries for SSH execution
   - Helper API endpoints for script runtime functions
   - JWT-based authentication

## Data Model

### Core Entities

#### Events

- Central automation unit containing scripts, HTTP requests, or tool actions
- Support multiple execution types: NODEJS, PYTHON, BASH, HTTP_REQUEST, TOOL_ACTION
- Can be scheduled (cron-like) or manually triggered
- Support both local (containerized) and remote (SSH) execution

#### Jobs

- Queue-based execution model with status tracking
- Priority levels: LOW, NORMAL, HIGH, CRITICAL
- Status flow: QUEUED → CLAIMED → RUNNING → COMPLETED/FAILED
- Atomic claiming prevents duplicate processing
- Automatic retry with exponential backoff

#### Executions

- Track individual execution attempts for jobs
- Support multi-server parallel execution
- Store output, error messages, and exit codes
- Link to specific servers for SSH executions

#### Workflows

- Multi-step event chains with conditional logic
- Node-based visual editor with drag-and-drop
- Connection types: ALWAYS, ON_SUCCESS, ON_FAILURE, ON_CONDITION
- Support for parallel and sequential execution
- Webhook and scheduled triggers

#### Servers

- SSH connection configurations for remote execution
- Support password and SSH key authentication
- Health monitoring and online status tracking
- Connection pooling for performance

#### Tool Credentials

- Plugin system for third-party integrations
- Support for Slack, Discord, Email, Teams, and custom tools
- OAuth flow support with token management
- Encrypted credential storage

## Execution Flow

### Event Execution Pipeline

1. **Event Trigger**
   - Manual trigger via UI/API
   - Scheduled trigger (cron-based)
   - Webhook trigger
   - Conditional trigger from other events

2. **Job Creation**
   - Event creates job in database queue
   - Job includes payload, metadata, and execution configuration
   - Priority and scheduling determined

3. **Job Polling**
   - Orchestrator polls database for queued jobs
   - Atomic claiming ensures single processor
   - Jobs distributed based on type and configuration

4. **Execution Routing**
   - **Container Executor**: Local Docker-based execution
   - **SSH Executor**: Remote server execution
   - **Multi-Server Executor**: Parallel execution across servers

5. **Status Updates**
   - Real-time updates via WebSocket
   - Execution records created and updated
   - Logs aggregated and stored

6. **Completion Handling**
   - Exit codes and output captured
   - Conditional actions triggered
   - Cleanup of resources and payloads

### Workflow Execution

1. **Workflow Trigger**
   - Manual, scheduled, or webhook initiation
   - Creates workflow execution record

2. **Node Traversal**
   - Topological sorting of workflow graph
   - Parallel execution of independent nodes
   - Connection conditions evaluated

3. **Event Execution**
   - Each node executes as standard event
   - Output passed to subsequent nodes
   - Branch conditions determine path

4. **Aggregation**
   - Individual event logs linked to workflow execution
   - Status aggregation (success, partial, failure)
   - Total duration and metrics tracked

## Execution Environments

### Containerized Execution (Local)

- **Isolation**: Each job runs in isolated Docker container
- **Resource Limits**: CPU, memory, disk, and PID limits enforced
- **Helper Support**: Full runtime helper API via sidecar container
- **Security**: Network isolation with optional restrictions
- **Cleanup**: Automatic container and volume cleanup

### SSH Execution (Remote)

- **Runner Binary**: Signed binary deployed to remote servers
- **Payload System**: Scripts packaged as tar.gz with manifest
- **Helper API**: Runtime helpers via HTTP callbacks to runtime service
- **Multi-Server**: Parallel execution across multiple servers
- **Cleanup**: Automatic runner and payload cleanup after execution

## Logging System

### Log Aggregation

- **Event Logs**: Primary execution records linked to events
- **Job Logs**: Detailed job execution tracking
- **Execution Logs**: Server-specific execution details
- **Workflow Logs**: Aggregated workflow execution history

### Log Status Mapping

- SUCCESS: Exit code 0, successful completion
- FAILURE: Non-zero exit code or error
- TIMEOUT: Execution exceeded time limit
- PARTIAL: Multi-server execution with mixed results
- RUNNING: Currently executing
- PENDING: Queued for execution

## Tool Plugin System

### Supported Integrations

- **Communication**: Slack, Discord, Microsoft Teams
- **Email**: SMTP, Gmail, SendGrid
- **Webhooks**: Custom HTTP endpoints
- **OAuth**: Google, GitHub, etc.

### Action Execution

1. Tool credentials stored encrypted in database
2. Actions defined with schemas and validation
3. Server-side execution with error handling
4. Rate limiting and quota management
5. Audit logging for compliance

## Security Features

### Credential Encryption

- **Algorithm**: AES-256-GCM with authenticated encryption
- **Key Derivation**: scrypt with salt and iterations
- **Master Key**: Environment-based configuration
- **Key Rotation**: Support for re-encryption
- **Caching**: Time-limited key cache for performance

### Authentication & Authorization

- **NextAuth**: Email/password and OAuth providers
- **Roles**: Admin, User, Viewer with granular permissions
- **API Tokens**: Long-lived tokens for programmatic access
- **JWT**: Service-to-service authentication

### Execution Security

- **Container Isolation**: Resource limits and network restrictions
- **SSH Security**: Key-based authentication preferred
- **Signed Binaries**: Runner binaries signed to prevent tampering
- **Payload Integrity**: Checksum verification

## UI Architecture

### Component Structure

- **Server Components**: Default for static content
- **Client Components**: Interactive features and real-time updates
- **Lazy Loading**: Code splitting for performance
- **Error Boundaries**: Graceful error handling

### Key UI Features

- **Dashboard**: Real-time statistics and monitoring
- **Event Management**: CRUD operations with bulk actions
- **Workflow Canvas**: Visual workflow editor with React Flow
- **Terminal**: Interactive SSH terminal via xterm.js
- **Code Editor**: Monaco editor with syntax highlighting
- **Log Viewer**: Real-time log streaming with WebSocket

## Real-time Features

### WebSocket Integration

- **Socket.IO**: Bidirectional communication
- **Log Streaming**: Real-time execution output
- **Status Updates**: Live job and execution status
- **Terminal Sessions**: Interactive SSH sessions
- **Broadcast System**: Multi-client synchronization

## Performance Optimizations

### Database

- **Job Queue**: Indexed for efficient polling
- **Connection Pooling**: Reused database connections
- **Batch Operations**: Bulk inserts and updates
- **Query Optimization**: Selective field loading

### Execution

- **Container Reuse**: Warm container pools
- **SSH Connection Pool**: Persistent connections
- **Runner Cache**: Cached runner binaries on servers
- **Payload Cleanup**: Automatic resource cleanup

### Frontend

- **React Query**: Intelligent caching and refetching
- **Code Splitting**: Lazy loading of heavy components
- **Suspense**: Streaming SSR with loading states
- **Virtual Scrolling**: Efficient large list rendering

## Monitoring & Observability

### Metrics

- **Job Statistics**: Queue depth, processing rate, success rate
- **Execution Metrics**: Duration, resource usage, error rates
- **Tool Usage**: API calls, rate limits, quotas
- **System Health**: Service availability, database connectivity

### Logging

- **Structured Logging**: JSON format with context
- **Log Levels**: DEBUG, INFO, WARNING, ERROR
- **Audit Trail**: User actions and changes
- **Error Tracking**: Detailed error capture and reporting

## Key Capabilities

1. **Flexible Execution**: Support for multiple languages and execution environments
2. **Scalability**: Queue-based architecture supports horizontal scaling
3. **Reliability**: Retry mechanisms, circuit breakers, and error recovery
4. **Security**: End-to-end encryption, role-based access, and audit logging
5. **Extensibility**: Plugin architecture for custom integrations
6. **User Experience**: Real-time updates, visual editors, and comprehensive monitoring
7. **Self-Hosted**: Complete control over data and infrastructure

## Development Considerations

### Technology Stack

- **Frontend**: Next.js 15, TypeScript, TailwindCSS, React Query
- **Backend**: Node.js, tRPC, Drizzle ORM, PostgreSQL
- **Services**: Go for orchestrator and runtime
- **Infrastructure**: Docker, Docker Compose
- **Monorepo**: Turborepo with PNPM workspaces

### Code Organization

- **Feature-based**: Components organized by feature
- **Shared Packages**: UI components, configurations
- **Type Safety**: End-to-end type safety with TypeScript
- **Testing**: Unit tests, integration tests, E2E tests

### Deployment

- **Containerized**: Docker images for all services
- **Environment Config**: Environment-based configuration
- **Database Migrations**: Drizzle Kit for schema management
- **CI/CD**: Automated testing and deployment pipelines

## Future Enhancements

Based on current implementation, potential areas for enhancement include:

1. **Kubernetes Executor**: Native K8s job execution
2. **Event Marketplace**: Share and discover automation templates
3. **Advanced Scheduling**: More complex scheduling patterns
4. **Workflow Templates**: Pre-built workflow patterns
5. **Enhanced Monitoring**: Prometheus metrics and Grafana dashboards
6. **API Gateway**: Rate limiting and API management
7. **Multi-tenancy**: Organization-level isolation
8. **Backup/Restore**: Automated backup and disaster recovery
