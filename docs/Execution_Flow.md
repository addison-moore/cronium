# Event Execution Flow

This document describes the complete execution flow for events in Cronium, covering both local (containerized) and remote (SSH) execution paths.

## Overview

The event execution system in Cronium follows a distributed architecture where:

- The Next.js application manages the UI and API
- A Go-based orchestrator service handles job execution
- Jobs are executed either in Docker containers (local) or via SSH (remote)

## Architecture Components

### 1. Next.js Application

- **UI Layer**: React components for event management
- **API Layer**: tRPC endpoints for job creation and management
- **Database**: PostgreSQL storing events, jobs, logs, and configuration

### 2. Orchestrator Service

- **Written in Go**: High-performance job processing
- **Job Queue Consumer**: Polls the API for queued jobs
- **Executor Manager**: Routes jobs to appropriate executors
- **Status Reporter**: Updates job status back to the API

### 3. Execution Engines

- **Container Executor**: Runs scripts in isolated Docker containers
- **SSH Executor**: Executes scripts on remote servers via SSH
- **HTTP Executor**: Makes HTTP requests (runs in container)

## Execution Flow

### Step 1: UI Trigger

When a user clicks "Run Now" on an event:

```
User Action → EventDetailsHeader → EventDetails → tRPC Mutation
```

The UI initiates an `executeEvent` mutation with the event ID and manual execution flag.

### Step 2: Job Creation (API Layer)

The tRPC `execute` endpoint (`src/server/api/routers/events.ts`):

1. **Validates Permissions**: Ensures user can execute the event
2. **Creates Log Entry**: Records execution attempt with PENDING status
3. **Builds Job Payload**: Constructs comprehensive job data
4. **Queues Job**: Inserts job into database with "queued" status
5. **Links Log to Job**: Updates log entry with job ID

### Step 3: Job Queue Management

The job service (`src/lib/services/job-service.ts`) manages:

- Job ID generation (`job_${nanoid(12)}`)
- Status tracking (queued → claimed → processing → completed/failed)
- Payload storage with all execution details
- Retry configuration

### Step 4: Orchestrator Polling

The orchestrator polls `/api/internal/jobs/queue` endpoint:

```
Orchestrator → API (with auth) → Claim Jobs → Transform → Return
```

Jobs are:

- Claimed by the orchestrator (marked as "claimed")
- Transformed to orchestrator format
- Returned for processing

### Step 5: Job Routing

The orchestrator determines execution type based on:

- **Has serverId**: Route to SSH Executor
- **No serverId**: Route to Container Executor
- **HTTP Request**: Route to Container Executor with HTTP client
- **Tool Action**: Route to Container Executor with tool runtime

### Step 6: Execution

#### Local/Container Execution

1. **Container Creation**: Docker container with appropriate runtime
2. **Environment Setup**: Variables, volumes, working directory
3. **Runtime Helper Injection**: Cronium runtime helpers made available
4. **Script Execution**: Run the script with timeout monitoring
5. **Log Streaming**: Real-time output via WebSocket
6. **Result Collection**: Exit code, final output, runtime data, duration

#### Remote/SSH Execution

1. **Connection Establishment**: SSH to target server
2. **Session Creation**: New SSH session for isolation
3. **Runtime Helper Transfer**: Send runtime helpers to remote
4. **Script Transfer**: Send script content to remote
5. **Remote Execution**: Run script on target server
6. **Output Streaming**: Real-time output back to orchestrator

### Step 7: Post-Execution Processing

After execution completes:

1. **Condition Evaluation**: Check if event set a condition via runtime helper
2. **Output Collection**: Retrieve output data set by the event
3. **Variable Updates**: Persist any variable changes back to database
4. **Conditional Actions**: Evaluate and trigger any configured actions

### Step 8: Status Updates

Throughout execution:

- Orchestrator sends status updates to `/api/internal/jobs/[id]/status`
- Log entries are updated with current status
- WebSocket broadcasts log updates to connected clients
- UI polls for updates while job is running

## Runtime Helpers

Runtime helpers provide a consistent API across different scripting languages for:

- **Data Flow**: Pass data between events using input/output
- **Variable Management**: Get/set global and user-scoped variables
- **Condition Setting**: Control conditional action execution
- **Event Metadata**: Access current event information

### Available Functions

#### JavaScript/Node.js

```javascript
const cronium = require("cronium");

// Data flow
const inputData = await cronium.input(); // Get data from previous event
await cronium.output(resultData); // Pass data to next event

// Variables
const value = await cronium.getVariable("key");
await cronium.setVariable("key", "value");

// Conditions
await cronium.setCondition(true); // Trigger ON_CONDITION actions

// Metadata
const eventInfo = await cronium.event(); // Get current event details
```

#### Python

```python
import cronium

# Data flow
input_data = cronium.input()
cronium.output(result_data)

# Variables
value = cronium.getVariable('key')
cronium.setVariable('key', 'value')

# Conditions
cronium.setCondition(True)

# Metadata
event_info = cronium.event()
```

#### Bash

```bash
# Source the runtime helper
source cronium.sh

# Data flow
input_data=$(cronium_input)
cronium_output "$result_data"

# Variables
value=$(cronium_getVariable "key")
cronium_setVariable "key" "value"

# Conditions
cronium_setCondition true

# Metadata
event_info=$(cronium_event)
```

## Conditional Actions

Conditional actions allow events to trigger subsequent actions based on execution outcomes:

### Trigger Types

- **ON_SUCCESS**: Triggered when the event completes successfully (exit code 0)
- **ON_FAILURE**: Triggered when the event fails (non-zero exit code)
- **ALWAYS**: Triggered regardless of the event outcome
- **ON_CONDITION**: Triggered when the event explicitly sets a condition via runtime helper

### Action Types

- **SEND_MESSAGE**: Send notifications via Email, Slack, or Discord
- **SCRIPT**: Execute another event, passing output data as input

### Execution Flow for Conditional Actions

1. **Configuration**: Users configure conditional actions in the event form
2. **Execution**: Event runs and may use runtime helpers to set data/conditions
3. **Evaluation**: System checks execution result and conditions
4. **Triggering**: Matching conditional actions are executed:
   - Message actions use the tool plugin system
   - Script actions create new jobs with data flow

## Data Flow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│     UI      │────▶│   tRPC API  │────▶│   Database   │
└─────────────┘     └─────────────┘     └──────────────┘
                            │                     ▲
                            ▼                     │
                    ┌─────────────┐               │
                    │ Job Service │───────────────┘
                    └─────────────┘
                            │
                            ▼
                    ┌─────────────┐
                    │  Job Queue  │
                    └─────────────┘
                            │
                    ┌───────┴────────┐
                    ▼                ▼
            ┌──────────────┐  ┌──────────────┐
            │ Internal API │  │  WebSocket   │
            └──────────────┘  └──────────────┘
                    │                ▲
                    ▼                │
            ┌──────────────┐         │
            │ Orchestrator │─────────┘
            └──────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌─────────────┐         ┌─────────────┐
│  Container  │         │     SSH     │
│  Executor   │         │  Executor   │
└─────────────┘         └─────────────┘
        │                       │
        └───────┬───────────────┘
                ▼
        ┌─────────────┐
        │   Runtime   │
        │   Helpers   │
        └─────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌─────────────┐  ┌─────────────┐
│ Conditional │  │    Data     │
│   Actions   │  │    Flow     │
└─────────────┘  └─────────────┘
```

## Key Design Decisions

### 1. Job Queue Architecture

- **Decoupled Processing**: API and execution are separate concerns
- **Scalability**: Multiple orchestrators can process jobs
- **Reliability**: Jobs persist in database until completed
- **Observability**: All job states are tracked

### 2. Container Isolation

- **Security**: User scripts run in isolated environments
- **Resource Control**: Memory and CPU limits per container
- **Clean Environment**: Fresh container for each execution
- **Runtime Support**: Multiple languages (bash, python, node)

### 3. Real-time Updates

- **WebSocket Streaming**: Live log output during execution
- **Status Polling**: UI updates while jobs are running
- **Event-Driven**: Status changes trigger UI updates

## Security Considerations

### Container Security

- Scripts run in isolated Docker containers
- No access to host filesystem (except mounted volumes)
- Network isolation options available
- Resource limits prevent abuse

### SSH Security

- Connection pooling with circuit breakers
- SSH key management for authentication
- Timeout protection for long-running scripts
- Error handling for connection failures

### API Security

- Internal endpoints protected by API keys
- Role-based access control for execution
- Audit logging of all executions
- Rate limiting on execution endpoints

### Runtime Helper Security

- File-based communication isolated per container
- Variables scoped to user accounts
- No cross-container data access
- Encrypted storage for sensitive variables

## Known Issues and Improvements

### Current Limitations

1. **Single Orchestrator**: Currently designed for single orchestrator instance
   - Could benefit from distributed orchestrator support
   - Load balancing between multiple orchestrators

2. **Job Priority**: No priority queue implementation
   - All jobs processed in FIFO order
   - High-priority jobs cannot jump the queue

3. **Resource Management**: Limited container resource allocation
   - Fixed memory/CPU limits
   - No dynamic resource allocation based on load

4. **Error Recovery**: Basic retry mechanism
   - Could implement exponential backoff
   - Better error categorization for retry decisions

5. **Runtime Helper Evolution**: Two implementations exist
   - Legacy file-based system (currently in use)
   - New HTTP API-based system (in development)
   - Migration path needed between systems

6. **Data Flow Limitations**:
   - Output data size limited by file system
   - No streaming support for large data sets
   - JSON-only data format restriction

### Suggested Improvements

1. **Distributed Processing**
   - Implement orchestrator clustering
   - Add job distribution algorithms
   - Support for job affinity/anti-affinity

2. **Enhanced Monitoring**
   - Metrics collection for execution times
   - Resource usage tracking
   - Performance analytics dashboard

3. **Advanced Scheduling**
   - Priority queues for urgent jobs
   - Job dependencies and workflows
   - Resource-based scheduling

4. **Execution Environments**
   - Support for custom Docker images
   - Language version management
   - Pre-warmed containers for faster startup

5. **Failure Handling**
   - Dead letter queue for failed jobs
   - Automatic incident creation
   - Failure pattern detection

6. **Runtime Helper Enhancements**
   - Complete migration to HTTP API-based system
   - Support for streaming large data sets
   - Binary data support
   - More language bindings (Ruby, Go, etc.)

7. **Conditional Action Improvements**
   - Complex condition expressions (AND/OR logic)
   - Delay actions (wait before triggering)
   - Conditional loops and retries
   - Dynamic action configuration based on output

## Conclusion

The current execution flow provides a solid foundation for running user scripts securely and reliably. The architecture effectively separates concerns:

- **API Layer** handles job management and queuing
- **Orchestrator** manages distributed execution
- **Executors** provide isolated environments
- **Runtime Helpers** enable data flow and automation
- **Conditional Actions** support complex workflows

The combination of containerized execution for security, runtime helpers for data flow, and conditional actions for workflow automation creates a powerful platform for scheduled task automation. The use of containers for local execution and SSH for remote execution covers the main use cases while maintaining security and isolation.

Future improvements should focus on:

1. Scalability through distributed orchestration
2. Enhanced observability and monitoring
3. Advanced scheduling and priority management
4. Completing the runtime helper API migration
5. Richer conditional action capabilities

These enhancements will support more complex use cases and larger deployments while maintaining the security and reliability of the current system.
