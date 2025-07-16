# Phase 1: Current Architecture Analysis

## Overview

This document provides a comprehensive analysis of Cronium's current event execution architecture, identifying key components, data flows, integration points, and areas of concern that must be addressed in the containerized migration.

## Core Architecture Components

### 1. Event Execution Service (`src/lib/services/execution/event-execution.service.ts`)

The central orchestrator for all event executions. Key responsibilities:

- Determines execution type based on event configuration
- Manages execution lifecycle (start, monitor, complete)
- Handles multi-server parallel execution
- Integrates with notification system for alerts
- Records execution history and metrics

**Key Methods:**

- `executeEvent()`: Main entry point for event execution
- `executeOnServers()`: Handles multi-server execution logic
- `handleExecutionResult()`: Processes results and updates status

### 2. Execution Modules

#### Local Script Executor (`local-script-executor.ts`)

Executes bash, Node.js, and Python scripts directly on the host system.

**Features:**

- Runtime helper injection (cronium.sh, cronium.js, cronium.py)
- Environment variable management
- Working directory handling
- Timeout enforcement
- Output capture (stdout/stderr)

**Security Concerns:**

- No isolation - direct host execution
- Unlimited resource access
- Shared file system access
- No network restrictions

#### SSH Script Executor (`ssh-script-executor.ts`)

Executes scripts on remote servers via SSH.

**Features:**

- Connection pooling for performance
- Key-based authentication
- Script upload and execution
- Output streaming
- Error handling and retry logic

**Implementation Details:**

- Uses `node-ssh` library
- Maintains connection pool per server
- Uploads scripts to temporary directory
- Executes with proper shell escaping

#### HTTP Request Executor (`http-request-executor.ts`)

Performs HTTP/HTTPS API calls.

**Features:**

- Multiple HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Header and body customization
- Basic and Bearer authentication
- Response parsing (JSON, text)
- Timeout handling

#### Tool Action Executor (`tool-action-executor.ts`)

Advanced execution framework for integrated tools.

**Features:**

- Rate limiting per tool
- Retry logic with exponential backoff
- Circuit breaker pattern
- Webhook support
- Custom authentication per tool

**Supported Tools:**

- Slack notifications
- Discord webhooks
- Email (SMTP)
- Custom webhook endpoints

### 3. Workflow System

#### Workflow Executor (`workflow-executor.ts`)

Orchestrates complex multi-step workflows.

**Features:**

- DAG (Directed Acyclic Graph) execution
- Parallel node execution where possible
- Data passing between nodes
- Conditional execution
- Error handling with configurable strategies

**Node Types:**

- Event nodes (execute other events)
- Condition nodes (branching logic)
- Action nodes (tool actions)

#### Workflow Node Executor (`workflow-node-executor.ts`)

Executes individual workflow nodes.

**Data Flow:**

- Input data from previous nodes
- Output data for subsequent nodes
- Variable persistence across nodes
- Condition evaluation

### 4. Supporting Services

#### Script Runner (`script-runner.ts`)

Low-level script execution utility.

**Responsibilities:**

- Process spawning
- Environment setup
- I/O stream handling
- Signal management
- Exit code processing

#### Runtime Helpers

Helper scripts injected into user scripts for enhanced functionality.

**Available Helpers:**

- `cronium.sh`: Bash helper functions
- `cronium.js`: Node.js helper module
- `cronium.py`: Python helper module

**Helper Functions:**

- `input()`: Retrieve input data from previous nodes
- `output()`: Set output data for next nodes
- `getVariable()`: Access persistent variables
- `setVariable()`: Store persistent variables
- `event()`: Access current event metadata
- `setCondition()`: Set workflow condition results

## Data Flow Architecture

### 1. Execution Context

Each execution maintains a context containing:

- Event configuration
- Server targets
- Environment variables
- Input data
- Execution metadata

### 2. Data Persistence

Temporary files used for data exchange:

- `/tmp/cronium/[executionId]/input.json`: Input data
- `/tmp/cronium/[executionId]/output.json`: Output data
- `/tmp/cronium/[executionId]/variables.json`: Persistent variables
- `/tmp/cronium/[executionId]/condition.json`: Condition results

### 3. Log Management

Current implementation:

- Logs captured via stdout/stderr
- Stored in database after execution completes
- No real-time streaming during execution
- WebSocket only used for terminal sessions

## API Integration Points

### 1. Execution Endpoints

- `POST /api/executions/run`: Trigger event execution
- `GET /api/executions/:id`: Get execution status
- `GET /api/executions/:id/logs`: Retrieve execution logs

### 2. Internal APIs

- Execution history recording
- Variable persistence
- Notification triggers
- Metrics collection

### 3. WebSocket Integration

- `/api/socket`: Terminal session management
- Not currently used for execution log streaming

## Security Analysis

### Critical Vulnerabilities

1. **No Execution Isolation**
   - Scripts run with Node.js process privileges
   - Full access to file system
   - Unrestricted network access
   - Can modify system configuration

2. **Resource Management**
   - No CPU limits
   - No memory limits
   - No disk I/O limits
   - No execution time limits (beyond timeout)

3. **Shared Runtime Environment**
   - Scripts can interfere with each other
   - No namespace isolation
   - Shared environment variables
   - Potential for data leakage

4. **Privilege Escalation**
   - Scripts run as application user
   - Can potentially access application secrets
   - No capability restrictions

### Security Recommendations

1. Implement container-based isolation
2. Enforce resource limits
3. Use separate namespaces per execution
4. Implement least-privilege execution
5. Add network policies

## Performance Characteristics

### Current Bottlenecks

1. **Sequential Server Execution**: Multi-server executions happen one at a time
2. **No Connection Reuse**: SSH connections not efficiently pooled
3. **Synchronous Operations**: Many operations block unnecessarily
4. **Large Log Storage**: All logs stored in database

### Performance Metrics

- Average script startup time: ~100ms (local)
- SSH connection overhead: ~500ms per connection
- HTTP request timeout: 30s default
- Maximum execution time: 3600s (1 hour) default

## Dependencies and External Systems

### NPM Packages

- `node-ssh`: SSH connection management
- `axios`: HTTP request execution
- `nodemailer`: Email sending
- `@slack/webhook`: Slack integration
- Various runtime dependencies for script execution

### System Requirements

- Node.js runtime for JavaScript execution
- Python interpreter for Python scripts
- Bash shell for shell scripts
- SSH client for remote execution

## Migration Considerations

### 1. Backward Compatibility

Must maintain:

- Runtime helper functionality
- Data passing mechanisms
- Variable persistence
- Environment variable access
- Execution history format

### 2. Feature Parity

Ensure support for:

- All script types (bash, Node.js, Python)
- HTTP requests
- SSH execution
- Tool actions
- Workflow orchestration

### 3. Data Migration

Need to handle:

- Existing event configurations
- SSH key management
- Tool configurations
- Workflow definitions

### 4. Performance Requirements

- Container startup overhead must be minimal
- Log streaming latency acceptable
- Resource overhead manageable
- Scaling capabilities improved

## Technical Debt Items

### High Priority

1. No execution isolation
2. Poor error handling in many components
3. Inefficient multi-server execution
4. Missing real-time log streaming
5. Inconsistent retry logic

### Medium Priority

1. Code duplication across executors
2. Tight coupling between components
3. Limited test coverage
4. Poor configuration management
5. Inadequate monitoring

### Low Priority

1. Inconsistent logging format
2. Missing TypeScript types in some areas
3. Outdated dependencies
4. Limited documentation
5. No performance benchmarks

## Summary

The current architecture provides a functional event execution system but lacks critical security isolation and modern operational features. The primary concerns are:

1. **Security**: Direct host execution without isolation
2. **Reliability**: Limited error handling and recovery
3. **Performance**: Inefficient resource usage and scaling
4. **Observability**: No real-time monitoring or log streaming

The migration to a containerized architecture must address these concerns while maintaining backward compatibility and improving the overall system reliability and security posture.
