# Phase 1: Execution Flow Diagrams

## Overview

This document contains detailed flow diagrams illustrating how Cronium currently executes events, manages workflows, and handles various execution scenarios. These diagrams are essential for understanding the current system before implementing the containerized architecture.

## 1. Single Event Execution Flow

```mermaid
sequenceDiagram
    participant UI as User Interface
    participant API as API Endpoint
    participant EES as Event Execution Service
    participant Executor as Script Executor
    participant Runner as Script Runner
    participant Process as System Process
    participant DB as Database

    UI->>API: POST /api/executions/run
    API->>EES: executeEvent(eventId, triggeredBy)
    EES->>DB: Create execution record
    EES->>DB: Get event configuration

    alt Script Event (bash/node/python)
        EES->>Executor: execute(script, options)
        Executor->>Executor: Prepare environment
        Executor->>Executor: Inject runtime helpers
        Executor->>Runner: spawn(command, args, env)
        Runner->>Process: Create child process
        Process-->>Runner: stdout/stderr streams
        Runner-->>Executor: Output/Exit code
        Executor-->>EES: ExecutionResult
    else HTTP Request
        EES->>Executor: executeHTTP(config)
        Executor->>Executor: Prepare request
        Executor->>External: HTTP Request
        External-->>Executor: Response
        Executor-->>EES: ExecutionResult
    else Tool Action
        EES->>Executor: executeToolAction(config)
        Executor->>Executor: Apply rate limiting
        Executor->>Executor: Check circuit breaker
        Executor->>Tool: Execute action
        Tool-->>Executor: Result
        Executor-->>EES: ExecutionResult
    end

    EES->>DB: Update execution status
    EES->>DB: Store logs
    EES-->>API: Execution ID
    API-->>UI: Response
```

## 2. Multi-Server Execution Flow

```mermaid
sequenceDiagram
    participant EES as Event Execution Service
    participant SSH as SSH Executor
    participant Pool as Connection Pool
    participant Server1 as Remote Server 1
    participant Server2 as Remote Server 2
    participant DB as Database

    EES->>EES: Get server list

    loop For each server (sequential)
        EES->>SSH: execute(script, server)
        SSH->>Pool: getConnection(serverId)

        alt Connection exists
            Pool-->>SSH: Existing connection
        else No connection
            Pool->>Server1: SSH connect
            Server1-->>Pool: Connection established
            Pool-->>SSH: New connection
        end

        SSH->>SSH: Upload script to temp dir
        SSH->>Server1: Execute script
        Server1-->>SSH: Output stream
        SSH-->>EES: Server result
        EES->>DB: Store server execution
    end

    EES->>EES: Aggregate results
    EES->>DB: Update overall status
```

## 3. Workflow Execution Flow

```mermaid
flowchart TB
    Start([Workflow Start]) --> BuildDAG[Build DAG from nodes]
    BuildDAG --> FindReady[Find ready nodes]

    FindReady --> HasReady{Any ready nodes?}
    HasReady -->|No| CheckPending{Any pending?}
    HasReady -->|Yes| ExecuteParallel[Execute nodes in parallel]

    ExecuteParallel --> NodeExec[Execute Node]

    NodeExec --> NodeType{Node Type?}
    NodeType -->|Event| ExecEvent[Execute Event]
    NodeType -->|Condition| EvalCondition[Evaluate Condition]
    NodeType -->|Action| ExecAction[Execute Tool Action]

    ExecEvent --> CollectOutput[Collect Output]
    EvalCondition --> SetCondition[Set Condition Result]
    ExecAction --> CollectOutput

    CollectOutput --> UpdateDAG[Update DAG Status]
    SetCondition --> UpdateDAG

    UpdateDAG --> PropagateData[Propagate Data to Children]
    PropagateData --> FindReady

    CheckPending -->|Yes| Error[Circular Dependency Error]
    CheckPending -->|No| Complete([Workflow Complete])
```

## 4. Runtime Helper Integration Flow

```mermaid
sequenceDiagram
    participant Script as User Script
    participant Helper as Runtime Helper
    participant FS as File System
    participant Executor as Script Executor

    Executor->>FS: Write input.json
    Executor->>Script: Execute with helpers

    Script->>Helper: cronium.input()
    Helper->>FS: Read input.json
    FS-->>Helper: Input data
    Helper-->>Script: Parsed data

    Script->>Helper: cronium.getVariable('key')
    Helper->>FS: Read variables.json
    FS-->>Helper: Variables
    Helper-->>Script: Variable value

    Script->>Helper: cronium.output(data)
    Helper->>FS: Write output.json

    Script->>Helper: cronium.setVariable('key', value)
    Helper->>FS: Update variables.json

    Script->>Helper: cronium.setCondition(result)
    Helper->>FS: Write condition.json

    Script-->>Executor: Exit
    Executor->>FS: Read output files
    Executor->>Executor: Process results
```

## 5. SSH Connection Management Flow

```mermaid
stateDiagram-v2
    [*] --> Idle: Connection Pool Created

    Idle --> Connecting: Request Connection
    Connecting --> Connected: Success
    Connecting --> Failed: Error

    Connected --> InUse: Acquire for execution
    InUse --> Connected: Release after execution

    Connected --> Validating: Periodic health check
    Validating --> Connected: Still alive
    Validating --> Disconnected: Connection lost

    Connected --> Disconnected: Idle timeout
    Failed --> Idle: Retry after delay
    Disconnected --> Idle: Ready for reconnect

    Connected --> [*]: Pool shutdown
    InUse --> [*]: Force shutdown
```

## 6. Tool Action Execution with Circuit Breaker

```mermaid
stateDiagram-v2
    [*] --> Closed: Initial State

    Closed --> Closed: Success
    Closed --> Open: Failure threshold reached

    Open --> HalfOpen: After timeout period

    HalfOpen --> Closed: Success
    HalfOpen --> Open: Failure

    state Closed {
        [*] --> RateLimit
        RateLimit --> Execute: Within limits
        RateLimit --> Reject: Rate exceeded
        Execute --> Success
        Execute --> Failure
        Failure --> RetryCheck
        RetryCheck --> Execute: Retry available
        RetryCheck --> Failed: No retries left
    }
```

## 7. Data Flow Through Workflow Nodes

```mermaid
graph LR
    subgraph Node A
        A_Input[Input] --> A_Process[Process]
        A_Process --> A_Output[Output]
        A_Process --> A_Vars[Variables]
    end

    subgraph Node B
        B_Input[Input] --> B_Process[Process]
        B_Process --> B_Output[Output]
        B_Process --> B_Cond[Condition]
    end

    subgraph Node C
        C_Input[Input] --> C_Process[Process]
        C_Process --> C_Output[Output]
    end

    subgraph Node D
        D_Input[Input] --> D_Process[Process]
        D_Process --> D_Output[Output]
    end

    A_Output --> B_Input
    A_Vars -.-> B_Process
    B_Output --> C_Input
    B_Output --> D_Input
    B_Cond -->|true| C_Process
    B_Cond -->|false| D_Process

    style A_Vars fill:#f9f,stroke:#333,stroke-width:2px,stroke-dasharray: 5 5
```

## 8. Current vs. Proposed Architecture

### Current Architecture

```mermaid
graph TB
    subgraph "Current - Direct Host Execution"
        UI1[UI] --> API1[API]
        API1 --> EES1[Event Service]
        EES1 --> Local1[Local Executor]
        EES1 --> SSH1[SSH Executor]
        Local1 --> Host[Host System]
        SSH1 --> Remote1[Remote Server]

        style Host fill:#f99,stroke:#333,stroke-width:2px
    end
```

### Proposed Architecture

```mermaid
graph TB
    subgraph "Proposed - Containerized Execution"
        UI2[UI] --> API2[API]
        API2 --> Queue[Job Queue]
        Queue --> Orch[Go Orchestrator]
        Orch --> Docker[Container Executor]
        Orch --> SSH2[SSH Executor]
        Docker --> Container[Isolated Container]
        SSH2 --> Remote2[Remote Server]

        Orch -.-> API2

        style Container fill:#9f9,stroke:#333,stroke-width:2px
    end
```

## Key Observations

### 1. Sequential Bottlenecks

- Multi-server executions happen sequentially, not in parallel
- No job queuing mechanism for better resource utilization
- Synchronous execution blocks API responses

### 2. Security Concerns

- Direct process spawning without isolation
- Shared file system access across executions
- No resource constraints or limits
- Scripts can access application secrets

### 3. Missing Features

- No real-time log streaming during execution
- Limited retry mechanisms
- Basic error handling
- No execution prioritization

### 4. Data Management

- Heavy reliance on temporary files
- No cleanup mechanism for orphaned files
- Variables stored in plain JSON files
- No data encryption or access control

### 5. Monitoring Gaps

- No execution metrics collection
- Limited visibility into resource usage
- No performance profiling
- Basic logging without structure

## Migration Impact Analysis

### Components Requiring Major Changes

1. **Event Execution Service**: Add job queuing logic
2. **Script Executors**: Replace with job submission
3. **Log Management**: Implement real-time streaming
4. **API Endpoints**: Add internal orchestrator APIs

### Components Requiring Minor Changes

1. **Runtime Helpers**: Ensure container compatibility
2. **SSH Executor**: Port to Go with improvements
3. **Database Schema**: Add job queue tables
4. **WebSocket Handler**: Extend for log streaming

### New Components Required

1. **Go Orchestrator**: Core execution engine
2. **Job Queue**: Persistent job storage
3. **Container Manager**: Docker integration
4. **Log Streamer**: Real-time log delivery

## Summary

These diagrams illustrate the complexity of the current execution system and highlight areas where the containerized architecture will provide significant improvements:

1. **Security**: Isolation through containers
2. **Performance**: Parallel execution capabilities
3. **Reliability**: Better error handling and recovery
4. **Observability**: Real-time monitoring and logging
5. **Scalability**: Distributed execution ready

The migration must carefully preserve the existing data flow patterns while introducing these improvements to ensure backward compatibility and a smooth transition.
