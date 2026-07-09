# Cronium Application Overview

_Date: October 6, 2025_

## Executive Summary

Cronium is a self-hosted automation platform that enables users to schedule and execute scripts (Bash, Node.js, Python) and HTTP requests across local containers and remote SSH servers. The platform features a comprehensive web interface, job queue system, and distributed execution architecture.

## Core Architecture

### Application Components

1. **Cronium App (Next.js 15)** - Main web application
   - User interface for managing events, servers, and executions
   - tRPC API for type-safe communication
   - WebSocket server for real-time features
   - Database management via Drizzle ORM

2. **Orchestrator Service (Go)** - Job execution manager
   - Polls job queue from database
   - Routes jobs to appropriate executors
   - Manages containerized and SSH execution
   - Handles job lifecycle and status updates

3. **Runtime Service (Go)** - SSH execution support
   - Provides signed runner binaries for SSH servers
   - Handles helper function execution
   - JWT-based authentication for secure communication

## Key Features

### 1. WebSocket Terminal

The terminal feature provides interactive SSH access to remote servers:

- **Implementation**: `TerminalWebSocketHandler` class manages sessions
- **Connection**: Uses Socket.IO for bidirectional communication
- **SSH Integration**: Leverages `node-ssh` for secure connections
- **Session Management**:
  - Unique session IDs per user/server combination
  - Automatic cleanup of idle sessions (10 min inactivity, 30 min max age)
  - Connection pooling for efficiency (max 5 connections)
- **Security**: Requires server credentials (SSH key or password)
- **Note**: Local terminal access is disabled - only remote SSH connections allowed

### 2. Database Schema

Core tables and relationships:

- **users**: User accounts with role-based permissions (USER/ADMIN)
- **events**: Scheduled scripts/HTTP requests with execution configuration
- **servers**: Remote SSH servers with encrypted credentials
- **jobs**: Queue for pending executions (central to the system)
- **executions**: Individual execution attempts with results
- **logs**: Execution history and output
- **workflows**: Multi-step event chains with conditional logic
- **toolCredentials**: Integration credentials (Slack, Discord, etc.)

Key enums:

- `JobStatus`: queued → claimed → running → completed/failed
- `EventType`: NODEJS, PYTHON, BASH, HTTP_REQUEST, TOOL_ACTION
- `RunLocation`: LOCAL (container) or REMOTE (SSH)

### 3. Server Management

Servers represent remote SSH targets:

- **Storage**: Server credentials in database with encryption
- **Authentication**: SSH key or password support
- **Connection Pooling**: Reuse connections via `SSHConnectionManager`
- **Testing**: Connection validation before saving
- **Archival**: Soft delete with scheduled permanent deletion

### 4. Execution Flow

#### Job Lifecycle:

1. **Event Trigger** → Creates job in database queue
2. **Orchestrator Polling** → Claims job atomically
3. **Execution Routing**:
   - Container: Local Docker execution
   - SSH: Remote server execution
4. **Status Updates** → Real-time via WebSocket
5. **Completion** → Results stored in database

#### Application vs Orchestrator Responsibilities:

**Cronium App**:

- User interface and API
- Job creation and queuing
- Credential management
- Real-time status updates
- Historical data storage

**Orchestrator**:

- Job polling and claiming
- Execution management
- Container lifecycle
- SSH runner deployment
- Status reporting to app

### 5. Execution Types

#### Containerized (Local):

- Runs in isolated Docker containers
- Full runtime helper support via sidecar
- Resource limits (CPU, memory, disk, PIDs)
- Automatic cleanup after execution
- Network isolation options

#### SSH (Remote):

- Deploys signed runner binary to servers
- Single or multi-server execution
- Runtime helpers via API callbacks
- Payload-based script distribution
- Automatic cleanup of runners/payloads

Key differences:

- **Container**: Full isolation, sidecar helpers, resource limits
- **SSH**: Remote execution, binary deployment, payload distribution

### 6. Credential Encryption

Multi-layer encryption strategy:

- **Server-Side**: AES-256-GCM encryption for data at rest
- **Client-Side**: Optional browser encryption before transmission
- **Master Key**: Environment variable `ENCRYPTION_KEY`
- **Encrypted Fields**:
  - servers: sshKey, password
  - users: password (bcrypt hashed)
  - envVars: value
  - apiTokens: token
  - systemSettings: sensitive values

### 7. Application UI Structure

- **Dashboard**: Overview and quick actions
- **Events**: Script/request management
- **Servers**: SSH server configuration
- **Workflows**: Visual workflow builder
- **Console**: Terminal interface for servers
- **Logs**: Execution history
- **Settings**: User and system configuration

## Terminal Feature Considerations

### Current Implementation Issues:

1. **WebSocket Connection**: Uses Socket.IO with session management
2. **SSH Authentication**: Supports both key and password auth
3. **Error Handling**: Connection failures provide detailed messages
4. **Resource Management**: Automatic cleanup but may have edge cases

### Potential Bug Areas:

1. **Session Cleanup**: May not handle all disconnection scenarios
2. **Connection Pooling**: Possible race conditions with concurrent access
3. **Terminal Resizing**: Dynamic resize handling via PTY
4. **Character Encoding**: Unicode support via addon
5. **Network Interruptions**: Reconnection logic may need improvement

## Security Considerations

1. **Authentication**: Next-Auth with role-based permissions
2. **Encryption**: AES-256-GCM for sensitive data
3. **SSH Keys**: Stored encrypted, never exposed to client
4. **JWT Tokens**: Signed tokens for service communication
5. **Network Isolation**: Optional container network isolation
6. **Input Validation**: Server-side validation for all inputs

## Key Integration Points

1. **Database**: PostgreSQL with Drizzle ORM
2. **Container Runtime**: Docker API for container management
3. **SSH Protocol**: node-ssh for terminal and execution
4. **WebSocket**: Socket.IO for real-time communication
5. **Job Queue**: Database-backed with atomic operations
6. **Logging**: Structured logging with Logrus (Go) and console (JS)

## Recommendations for Terminal Debugging

1. Review WebSocket connection lifecycle management
2. Verify SSH connection pool cleanup on errors
3. Test edge cases (network interruptions, server disconnects)
4. Validate terminal resize event handling
5. Check for memory leaks in long-running sessions
6. Ensure proper error propagation to client
7. Verify session cleanup on browser refresh/close

## Summary

Cronium is a comprehensive automation platform with sophisticated job execution, credential management, and real-time communication capabilities. The terminal feature is a critical component that provides interactive server access through WebSocket-based SSH connections. The architecture separates concerns effectively between the web application (user interface, API, data management) and the orchestrator service (execution, container management, SSH deployment).
