# Lightweight Container Isolation Implementation Plan

## Executive Summary

This plan outlines the migration from direct script execution to containerized execution using a nested Docker architecture. The implementation maintains compatibility with self-hosted deployments via `docker-compose up -d` while providing strong isolation for user scripts.

## Current State Analysis

### Existing Architecture

- **Direct Execution**: Scripts run as child processes of the Node.js server
- **No Isolation**: Full access to host filesystem and network
- **Basic Executor**: Docker setup exists but not integrated with execution flow
- **File-Based Communication**: JSON files for input/output exchange

### What Already Exists

1. Docker compose configuration with executor service
2. Executor container with runtime helpers
3. Security constraints (seccomp, read-only root, etc.)
4. Runtime helpers for all supported languages

### What Needs to Be Built

1. Executor service that spawns isolated containers
2. Integration between main app and executor service
3. Migration of execution logic to use containers
4. Resource management and queuing system

## Implementation Phases

### Phase 1: Executor Service Foundation (Week 1-2)

#### 1.1 Create Executor Service

Create a new Node.js service that runs inside the executor container and manages script executions.

**New Files:**

- `docker/executor/src/server.ts` - Main executor service
- `docker/executor/src/ContainerManager.ts` - Docker container lifecycle
- `docker/executor/src/ResourceManager.ts` - Resource allocation and limits
- `docker/executor/src/ExecutionQueue.ts` - Queue management

**Key Components:**

```typescript
// docker/executor/src/server.ts
interface ExecutionRequest {
  id: string;
  userId: string;
  script: string;
  language: "javascript" | "python" | "bash";
  timeout: number;
  input?: any;
  variables?: Record<string, any>;
  eventMetadata?: any;
}

interface ExecutionResult {
  id: string;
  success: boolean;
  output?: any;
  error?: string;
  logs: string;
  duration: number;
  variables?: Record<string, any>;
  condition?: any;
}
```

#### 1.2 Update Executor Dockerfile

Modify the executor to run the service instead of sleeping:

**Changes to `docker/executor/Dockerfile`:**

- Add Node.js application files
- Install Docker CLI for container management
- Configure service startup

### Phase 2: Container Management (Week 2-3)

#### 2.1 Implement Container Spawning

Create the container management logic within the executor service.

**Key Features:**

- Create isolated containers for each execution
- Mount runtime helpers into containers
- Configure resource limits based on user tier
- Implement timeout enforcement

**Container Configuration:**

```typescript
const containerConfig = {
  Image: "cronium/executor:latest",
  Cmd: [language, "/tmp/execution/script"],
  HostConfig: {
    AutoRemove: true,
    Memory: 512 * 1024 * 1024, // 512MB
    CpuQuota: 50000, // 0.5 CPU
    NetworkMode: "none",
    ReadonlyRootfs: true,
    Tmpfs: {
      "/tmp": "size=100m",
      "/tmp/execution": "size=50m",
    },
  },
  Env: [
    `CRONIUM_EXECUTION_ID=${executionId}`,
    // ... other environment variables
  ],
};
```

#### 2.2 Data Exchange Implementation

Replace file-based communication with stdin/stdout pipes.

**Changes Required:**

- Modify runtime helpers to read from stdin
- Update output collection to use stdout
- Implement streaming for real-time logs

### Phase 3: Integration with Main Application (Week 3-4)

#### 3.1 Create Executor Client

Build a client library for the main app to communicate with the executor service.

**New File:**

- `src/lib/executor/ExecutorClient.ts`

**Key Methods:**

```typescript
class ExecutorClient {
  async executeScript(request: ExecutionRequest): Promise<ExecutionResult>;
  async getExecutionStatus(id: string): Promise<ExecutionStatus>;
  async cancelExecution(id: string): Promise<void>;
  async getResourceUsage(): Promise<ResourceUsage>;
}
```

#### 3.2 Migrate Local Executor

Update `local-executor.ts` to use the executor service instead of direct execution.

**Changes to `src/lib/executor/local-executor.ts`:**

- Replace `child_process.exec` with executor client calls
- Remove temporary file management
- Update error handling for container failures

### Phase 4: Resource Management (Week 4-5)

#### 4.1 Implement Resource Limits

Add proper resource management based on user tiers.

**Components:**

- CPU and memory quotas
- Concurrent execution limits
- Queue prioritization
- Usage tracking

#### 4.2 Add Monitoring

Implement basic monitoring for the executor service.

**Metrics to Track:**

- Active executions
- Queue length
- Resource utilization
- Execution success/failure rates

### Phase 5: Testing and Migration (Week 5-6)

#### 5.1 Testing Strategy

- Unit tests for executor service components
- Integration tests for end-to-end execution
- Performance benchmarks
- Security validation

#### 5.2 Migration Path

1. Feature flag for containerized execution
2. Gradual rollout to subset of users
3. Monitor performance and stability
4. Full migration with fallback option

## Technical Specifications

### API Between App and Executor

**REST API Endpoints:**

```
POST   /execute     - Submit new execution
GET    /status/:id  - Get execution status
DELETE /cancel/:id  - Cancel running execution
GET    /health      - Health check
GET    /metrics     - Resource usage metrics
```

### Security Considerations

1. **Network Isolation**: Containers have no network by default
2. **Filesystem**: Read-only root with limited tmpfs
3. **Capabilities**: All capabilities dropped
4. **User**: Non-root execution
5. **Resource Limits**: Hard limits on CPU/memory

### Configuration

**Environment Variables:**

```bash
# Executor Service
EXECUTOR_PORT=3000
MAX_CONCURRENT_EXECUTIONS=10
DEFAULT_TIMEOUT=300
DOCKER_SOCKET=/var/run/docker.sock

# Main App
EXECUTOR_URL=http://executor:3000
EXECUTOR_TIMEOUT=330
```

## File Structure

```
cronium/
├── docker/
│   └── executor/
│       ├── Dockerfile
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── server.ts
│           ├── ContainerManager.ts
│           ├── ResourceManager.ts
│           ├── ExecutionQueue.ts
│           └── types.ts
├── src/
│   └── lib/
│       └── executor/
│           ├── ExecutorClient.ts
│           ├── local-executor.ts (modified)
│           └── types.ts
```

## Dependencies

### New Dependencies for Executor Service

```json
{
  "dependencies": {
    "dockerode": "^4.0.0",
    "express": "^4.18.0",
    "p-queue": "^7.0.0",
    "winston": "^3.0.0"
  }
}
```

### Updated docker-compose.yml

```yaml
executor:
  build:
    context: ./docker/executor
  environment:
    - EXECUTOR_MODE=service
    - DOCKER_HOST=unix:///var/run/docker.sock
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  command: ["node", "dist/server.js"]
```

## Success Criteria

1. **Functionality**: All existing script execution features work
2. **Security**: Scripts cannot access host system
3. **Performance**: < 2 second overhead for execution
4. **Reliability**: 99%+ execution success rate
5. **Simplicity**: Single `docker-compose up -d` deployment

## Risks and Mitigation

| Risk                        | Impact | Mitigation                           |
| --------------------------- | ------ | ------------------------------------ |
| Docker-in-Docker complexity | High   | Use socket mounting instead of DinD  |
| Performance overhead        | Medium | Pre-pulled images, optimized startup |
| Resource exhaustion         | Medium | Queue management, hard limits        |
| Breaking changes            | High   | Feature flags, gradual rollout       |

## Timeline Summary

- **Week 1-2**: Executor service foundation
- **Week 2-3**: Container management implementation
- **Week 3-4**: Integration with main application
- **Week 4-5**: Resource management and monitoring
- **Week 5-6**: Testing and migration

Total estimated time: 6 weeks for full implementation

## Next Steps

1. Review and approve this plan
2. Set up development branch for implementation
3. Begin Phase 1: Executor Service Foundation
4. Create detailed technical specifications for each component
5. Establish testing framework early in the process
