# Lightweight Isolation Architecture for Self-Hosted Cronium

## Overview

This document presents a practical isolation architecture that balances security with ease of deployment for self-hosted Cronium instances. The solution must work within a standard Docker Compose setup while still providing meaningful isolation for user script execution.

## Design Constraints

1. **Must work with `docker-compose up -d`**
2. **No bare metal or hypervisor requirements**
3. **Minimal configuration for self-hosters**
4. **Cross-platform compatibility (Linux, macOS via Docker Desktop, Windows via WSL2)**
5. **Resource efficient for small-scale deployments**

## Proposed Architecture: Nested Container Isolation

### Core Concept

Run a privileged "executor" container that can spawn isolated child containers for each script execution. This provides strong isolation while remaining compatible with Docker Compose.

```yaml
# docker-compose.yaml
version: "3.8"
services:
  app:
    image: cronium/app:latest
    ports:
      - "5001:5001"
    environment:
      - DATABASE_URL=postgresql://...
      - EXECUTOR_URL=http://executor:3000
    depends_on:
      - postgres
      - executor

  executor:
    image: cronium/executor:latest
    privileged: true # Required for Docker-in-Docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock # Or use DinD
      - executor-cache:/var/lib/docker
    environment:
      - ISOLATION_MODE=docker
      - MAX_CONCURRENT_EXECUTIONS=10
      - RESOURCE_LIMITS_ENABLED=true
    security_opt:
      - apparmor:unconfined # For Docker operations
      - seccomp:unconfined

  postgres:
    image: postgres:15
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=secure-password

volumes:
  postgres-data:
  executor-cache:
```

### Executor Service Architecture

```typescript
// Executor service that manages isolated executions
class ExecutorService {
  private docker: Docker;
  private executionQueue: Queue<ExecutionRequest>;
  private resourceManager: ResourceManager;

  constructor(config: ExecutorConfig) {
    this.docker = new Docker({
      socketPath: config.dockerSocket || "/var/run/docker.sock",
    });

    this.resourceManager = new ResourceManager({
      maxConcurrent: config.maxConcurrent || 10,
      maxMemoryPerExecution: config.maxMemoryPerExecution || 512 * 1024 * 1024,
      maxCpuPerExecution: config.maxCpuPerExecution || 0.5,
    });
  }

  async executeScript(request: ExecutionRequest): Promise<ExecutionResult> {
    // Check resource availability
    await this.resourceManager.acquireSlot(request.userId);

    try {
      // Create isolated container for this execution
      const container = await this.createExecutionContainer(request);

      // Run the script
      const result = await this.runContainer(container, request);

      return result;
    } finally {
      this.resourceManager.releaseSlot(request.userId);
    }
  }

  private async createExecutionContainer(
    request: ExecutionRequest,
  ): Promise<Container> {
    const image = this.getImageForLanguage(request.language);

    return await this.docker.createContainer({
      Image: image,
      Cmd: this.buildCommand(request),
      HostConfig: {
        AutoRemove: true,
        Memory: this.resourceManager.getMemoryLimit(request.userTier),
        CpuQuota: this.resourceManager.getCpuQuota(request.userTier),
        NetworkMode: "none", // No network by default
        ReadonlyRootfs: true,
        Tmpfs: {
          "/tmp": "size=100m,mode=1777",
          "/run": "size=10m,mode=0755",
        },
        SecurityOpt: ["no-new-privileges"],
        CapDrop: ["ALL"], // Drop all capabilities
      },
      Env: [
        `CRONIUM_EVENT_ID=${request.eventId}`,
        `CRONIUM_USER_ID=${request.userId}`,
        ...this.buildEnvironment(request),
      ],
    });
  }
}
```

## Alternative Approaches

### Option 1: gVisor Integration (Recommended for Linux)

Use gVisor as a runtime for enhanced isolation without full virtualization.

```yaml
executor:
  image: cronium/executor:latest
  environment:
    - RUNTIME=gvisor # Use runsc runtime
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - /usr/local/bin/runsc:/usr/local/bin/runsc # Mount gVisor binary
```

```typescript
// Enhanced container creation with gVisor
private async createExecutionContainer(request: ExecutionRequest): Promise<Container> {
  const useGvisor = process.env.RUNTIME === 'gvisor' && await this.isGvisorAvailable();

  return await this.docker.createContainer({
    Image: image,
    HostConfig: {
      Runtime: useGvisor ? 'runsc' : 'runc',  // Use gVisor if available
      // ... other config
    }
  });
}
```

### Option 2: Podman-in-Docker

Use Podman inside the executor container for daemonless container management.

```dockerfile
# Executor Dockerfile
FROM quay.io/podman/stable:latest

RUN dnf install -y nodejs npm && \
    npm install -g typescript

COPY executor-app /app
WORKDIR /app

# Podman can run rootless containers inside this container
CMD ["node", "server.js"]
```

### Option 3: Bubblewrap-based Isolation

For maximum simplicity, use Bubblewrap (bwrap) for lightweight sandboxing.

```typescript
class BubblewrapExecutor {
  async execute(script: string, language: string): Promise<ExecutionResult> {
    const sandboxDir = await this.prepareSandbox(script);

    const args = [
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--tmpfs",
      "/run",
      "--bind",
      sandboxDir,
      "/workspace",
      "--chdir",
      "/workspace",
      "--setenv",
      "HOME",
      "/workspace",
      "--",
      this.getInterpreter(language),
      "script.js",
    ];

    const result = await spawn("bwrap", args);
    return this.parseResult(result);
  }
}
```

## Resource Management Without Cgroups

Since we're running inside a container, we need application-level resource management:

```typescript
class ApplicationResourceManager {
  private activeExecutions: Map<string, ExecutionTracker>;
  private memoryUsage: Map<string, number>;

  async enforceMemoryLimit(
    execution: ExecutionProcess,
    limitMB: number,
  ): Promise<void> {
    const checkInterval = setInterval(async () => {
      const usage = await this.getProcessMemoryUsage(execution.pid);

      if (usage > limitMB * 1024 * 1024) {
        execution.kill("SIGTERM");
        clearInterval(checkInterval);
        throw new Error("Memory limit exceeded");
      }
    }, 1000);

    execution.on("exit", () => clearInterval(checkInterval));
  }

  async enforceTimeLimit(
    execution: ExecutionProcess,
    limitSeconds: number,
  ): Promise<void> {
    const timeout = setTimeout(() => {
      execution.kill("SIGTERM");
      setTimeout(() => execution.kill("SIGKILL"), 5000);
    }, limitSeconds * 1000);

    execution.on("exit", () => clearTimeout(timeout));
  }
}
```

## Network Isolation Strategies

### 1. Application-Level Proxy

Route all network requests through an application proxy:

```typescript
class NetworkProxy {
  private allowedDomains: Set<string>;
  private blockedPorts: number[];

  async createProxyForExecution(executionId: string): Promise<ProxyConfig> {
    const port = await this.allocatePort();

    const proxy = httpProxy.createProxyServer({
      target: {
        host: "localhost",
        port: port,
      },
    });

    proxy.on("proxyReq", (proxyReq, req, res) => {
      const url = new URL(req.url);

      if (!this.isAllowedDomain(url.hostname)) {
        res.writeHead(403);
        res.end("Domain not allowed");
        return;
      }

      if (this.blockedPorts.includes(url.port)) {
        res.writeHead(403);
        res.end("Port not allowed");
        return;
      }
    });

    return { port, proxy };
  }
}
```

### 2. iptables Rules (Linux only)

For Linux hosts, use iptables within the executor container:

```bash
#!/bin/bash
# Setup network isolation for execution
EXECUTION_ID=$1
CONTAINER_IP=$2

# Create new chain for this execution
iptables -N CRONIUM_EXEC_$EXECUTION_ID

# Default deny all
iptables -A CRONIUM_EXEC_$EXECUTION_ID -j DROP

# Allow specific destinations
iptables -I CRONIUM_EXEC_$EXECUTION_ID -d 8.8.8.8 -j ACCEPT  # DNS
iptables -I CRONIUM_EXEC_$EXECUTION_ID -d 10.0.0.0/8 -j DROP  # Block internal

# Apply to container
iptables -I FORWARD -s $CONTAINER_IP -j CRONIUM_EXEC_$EXECUTION_ID
```

## Simple Deployment Guide

### For Self-Hosters

1. **Basic Setup** (No special isolation):

```bash
git clone https://github.com/cronium/cronium
cd cronium
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

2. **Enhanced Security** (With gVisor - Linux only):

```bash
# Install gVisor
curl -fsSL https://gvisor.dev/archive.key | sudo apt-key add -
echo "deb https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
sudo apt update && sudo apt install runsc

# Configure Docker to use gVisor
sudo runsc install

# Start Cronium with gVisor
RUNTIME=gvisor docker-compose up -d
```

3. **Maximum Compatibility** (Works everywhere):

```bash
# Just run it - uses built-in isolation
docker-compose up -d
```

## Security Levels

### Level 1: Basic (Default)

- Process isolation via Docker
- Resource limits
- No network access
- Temporary filesystem only

### Level 2: Enhanced (Opt-in)

- gVisor runtime (if available)
- Stricter seccomp profiles
- Read-only root filesystem
- No capabilities

### Level 3: Paranoid (Manual setup)

- Dedicated Docker network
- External firewall rules
- SELinux/AppArmor policies
- Audit logging

## Implementation Recommendations

1. **Start with Basic Isolation**: Docker containers with strict security options
2. **Progressive Enhancement**: Detect and use better isolation when available
3. **Clear Documentation**: Show users how to enable additional security
4. **Sensible Defaults**: Work out-of-the-box with reasonable security

## Conclusion

This architecture provides:

- ✅ Simple deployment via Docker Compose
- ✅ No bare metal requirements
- ✅ Cross-platform compatibility
- ✅ Progressive security enhancement
- ✅ Resource isolation
- ✅ Network control

While not as secure as Firecracker, it offers practical isolation suitable for self-hosted deployments while maintaining the simplicity that open-source users expect.
