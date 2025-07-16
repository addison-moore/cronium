# Cronium: Containerized Execution Architecture

## Overview

The new execution system for Cronium introduces a containerized architecture centered around a Go-based daemon called `cronium-agent`. This architecture replaces the legacy bare-metal execution model and consolidates execution responsibilities under the agent, enabling secure, isolated, and distributed script execution across local and remote environments.

---

## Goals

- Isolated execution of events in containers
- Distributed execution across multiple servers
- Secure SSH-based execution retained for specific use cases
- Real-time log streaming and execution monitoring
- Reliable, fault-tolerant job processing
- Simple setup for early users

---

## Phased Rollout Strategy

### Stage 1: MVP Execution Engine

- Bundle `cronium-agent` (orchestrator written in Go) and the Next.js backend into a single container
- Support local containerized execution using Docker
- Support remote execution via SSH (handled by the embedded orchestrator)
- Maintain modular design for future expansion

### Stage 2: Remote Execution Support

- Introduce standalone remote execution agents
- Secure push-based job delivery from orchestrator to agents
- Job buffering, retry logic, and health monitoring for remote agents

This phased rollout allows early adopters to get started with minimal setup, while laying the groundwork for scalable, distributed execution in later versions.

---

## System Components

### 1. **Cronium Backend (Next.js App + Orchestrator Agent)**

- Deployed as a single container in Stage 1
- Hosts the UI and API
- Stores events, workflows, users, SSH targets, logs, and variables
- Pulls jobs from the API and executes them locally or remotely via SSH

### 2. **Remote Execution Agent (Stage 2)**

- Receives jobs pushed by the orchestrator
- Runs each job in an isolated Docker container
- Optionally buffers jobs if offline or under load
- Streams logs and results back to orchestrator

---

## Execution Modes

### Supported Targets

| Type                | Method                  | Description                                |
| ------------------- | ----------------------- | ------------------------------------------ |
| Local Container     | Docker (isolated)       | Runs in container on orchestrator's host   |
| Remote Server (SSH) | SSH                     | Executes directly on server via SSH        |
| Remote Agent        | Docker (isolated, push) | Runs in container on remote host (Stage 2) |

### Job Flow (Stage 1)

1. Orchestrator pulls job from backend
2. Resolves execution target (local container or SSH)
3. Executes job
4. Captures stdout, stderr, exit code, and outputs
5. Reports back to backend API

### Job Flow (Stage 2)

1. Orchestrator pushes job to remote agent if configured
2. Remote agent runs job, streams logs and results
3. Orchestrator aggregates output and updates backend

---

## Agent Configuration

All agents share the same binary. Behavior is determined by config flags:

```yaml
mode: orchestrator | remote-executor
api_token: xxxx
labels: [us-west, db, production]
enable_ssh: true
```

---

## SSH Target Execution

- Configured per user/server in Cronium UI
- Stored encrypted in database
- Orchestrator agent decrypts and connects directly
- SSH logic mirrors legacy behavior:
  - Create temp dir
  - Transfer script, runtime, inputs
  - Execute script
  - Read outputs/conditions
  - Cleanup
- SSH targets do **not** support labels

---

## Container Execution Strategy

### Default Model: Ephemeral Containers

- Each job runs in a fresh Docker container
- Fully isolated per-job environment
- Uses prebuilt base images (e.g., `cronium/python`, `cronium/node`, `cronium/bash`)

### Optimization: Prewarmed Containers (Future)

- For high-frequency jobs
- Maintain long-running language runtimes (e.g., Python, Node.js)
- Jobs streamed via stdin/stdout or mounted volumes
- Faster execution, lower overhead

---

## Communication

### Orchestrator Agent

- Pulls jobs from backend queue
- Executes them locally or via SSH (Stage 1)
- Pushes jobs to remote agents (Stage 2)
- Manages retries, timeout, and concurrency limits

### Remote Agent (Stage 2)

- Exposes internal API to receive job payloads
- Buffers jobs if under load
- Executes using Docker
- Reports logs and status back to orchestrator

---

## Queuing Strategy

- **Backend**: Global job queue maintained by Cronium API
- **Orchestrator**: Pulls jobs, determines target, and dispatches
- **Remote Agents**: May queue jobs internally for reliability and retry (Stage 2)

---

## Security

- API tokens for authenticating agents
- Non-root containers with restricted Linux capabilities
- Secrets passed securely via environment vars or mounted files
- SSH keys decrypted only at runtime on orchestrator

---

## Monitoring & Observability

- Heartbeat from agents to backend (Stage 2)
- Live job log streaming
- Job metadata reporting (start time, duration, exit code, retries)
- Prometheus-compatible metrics endpoints (planned)

---

## Future Enhancements (Planned)

- Agent-side auto-upgrade
- Label-based job routing
- Pluggable execution runtimes (e.g., gVisor, Firecracker)
- In-process execution sandbox for trusted scripts
- Custom Dockerfile support per event

---

## Open Questions (Resolved)

- ✅ **Remote agents receive jobs via push from orchestrator (Stage 2)**
- ✅ **Hybrid queue model: backend pulls → remote agents buffer**
- ✅ **SSH targets configured via UI, no labels**

---

## Next Steps

1. Implement SSH execution logic in Go agent (embedded in backend container)
2. Add support for local container execution
3. Add live log streaming and job status reporting
4. UI dashboard for execution history and job results
5. Design communication protocol and API schema for remote agents (Stage 2)
