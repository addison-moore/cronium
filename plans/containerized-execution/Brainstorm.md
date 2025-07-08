# Containerized Execution Architecture Brainstorm

## Overview

This document explores various approaches for implementing containerized execution in Cronium, considering security, performance, resource utilization, and user experience. Our goal is to evaluate all options before committing to a specific architecture.

## Current Execution Model Analysis

### How Scripts Currently Execute

1. **Local Execution**:
   - Scripts run as child processes of the Node.js server
   - Temporary directories created in `/tmp/cronium_script_[timestamp]`
   - Full access to host filesystem and network
   - No resource limits enforced
   - Environment variables passed directly from parent process

2. **Data Exchange**:
   - JSON files used for input/output communication
   - Runtime helpers copied to temp directory
   - File-based state management (variables.json, condition.json)

3. **Security Concerns**:
   - Scripts run with server process privileges
   - No isolation between different users' scripts
   - Full system access possible
   - No resource quotas

## Container Architecture Options

### Option 1: Shared Container Pool

**Concept**: Maintain a pool of pre-warmed containers that handle multiple executions

**Pros**:

- Lower resource usage
- Faster startup times (containers already running)
- Efficient for high-frequency, short-lived scripts
- Simpler resource management

**Cons**:

- Security risks from shared execution environment
- Potential for cross-contamination between executions
- Complex cleanup between executions
- Difficult to enforce per-user quotas

**Implementation Considerations**:

```yaml
container_pool:
  min_size: 5
  max_size: 20
  idle_timeout: 300s
  cleanup_between_runs: true
  reset_filesystem: true
```

### Option 2: Per-Event Containers

**Concept**: Each event execution gets its own container instance

**Pros**:

- Complete isolation between executions
- Clean environment for each run
- Easy to enforce resource limits per event
- Simple cleanup (destroy container)
- Better for debugging (can preserve failed containers)

**Cons**:

- Higher resource overhead
- Slower startup times (container creation)
- More complex orchestration
- Potential for resource exhaustion

**Implementation Considerations**:

```yaml
per_event_container:
  image: cronium/execution-env:latest
  limits:
    cpu: 0.5
    memory: 512Mi
    disk: 1Gi
  timeout: event.timeout || 300s
  auto_remove: true
```

### Option 3: User-Scoped Containers

**Concept**: Each user gets dedicated container(s) for their executions

**Pros**:

- Balance between isolation and efficiency
- User-specific customization possible
- Better resource allocation per user
- Persistent user workspace possible

**Cons**:

- Complex lifecycle management
- Resource waste for inactive users
- Scaling challenges with many users
- State management complexity

**Implementation Considerations**:

```yaml
user_containers:
  per_user_limit: 3
  idle_shutdown: 3600s
  persistent_volume: /home/cronium-user
  resource_quotas:
    by_tier:
      free: { cpu: 0.5, memory: 512Mi }
      pro: { cpu: 2, memory: 2Gi }
      enterprise: { cpu: 8, memory: 8Gi }
```

### Option 4: Hybrid Approach

**Concept**: Use different strategies based on execution characteristics

**Decision Matrix**:

```
if (execution_frequency > 1/minute) → Shared Pool
else if (requires_isolation || untrusted_source) → Per-Event Container
else if (user.tier == "enterprise") → Dedicated User Container
else → Default Pool
```

## Container Technology Comparison

### Docker

**Pros**:

- Industry standard with extensive tooling
- Rich ecosystem and image registry
- Excellent isolation and security features
- Built-in resource limits and monitoring
- Multi-platform support

**Cons**:

- Requires Docker daemon
- Higher resource overhead
- Complex networking for inter-container communication
- Root daemon security concerns

**Implementation Example**:

```javascript
const container = await docker.createContainer({
  Image: "cronium/executor:node18",
  Cmd: ["node", "/tmp/script.js"],
  WorkingDir: "/workspace",
  HostConfig: {
    Memory: 512 * 1024 * 1024,
    CpuQuota: 50000,
    AutoRemove: true,
    ReadonlyRootfs: true,
    Tmpfs: { "/tmp": "size=100m" },
  },
});
```

### LXC/LXD

**Pros**:

- Lighter weight than Docker
- System container approach (full OS environment)
- Better performance for long-running processes
- Native Linux integration

**Cons**:

- Linux-only
- Less tooling and ecosystem
- More complex to set up
- Requires more OS-level configuration

**Implementation Example**:

```bash
lxc launch images:alpine/3.18 cronium-exec-${EVENT_ID}
lxc config set cronium-exec-${EVENT_ID} limits.cpu 1
lxc config set cronium-exec-${EVENT_ID} limits.memory 512MB
lxc exec cronium-exec-${EVENT_ID} -- /bin/sh /tmp/script.sh
```

### Firecracker

**Pros**:

- Micro-VM approach with strong isolation
- Very fast startup times (<125ms)
- Minimal overhead
- Used by AWS Lambda

**Cons**:

- Linux-only with KVM requirement
- More complex to implement
- Limited ecosystem
- Requires custom integration

### Podman

**Pros**:

- Daemonless architecture (more secure)
- Docker-compatible CLI
- Rootless containers by default
- Better systemd integration

**Cons**:

- Smaller ecosystem
- Some Docker features missing
- Less mature than Docker

### chroot + cgroups + namespaces

**Pros**:

- Minimal overhead
- Fine-grained control
- No external dependencies
- Native Linux features

**Cons**:

- Complex to implement correctly
- Easy to miss security aspects
- Manual resource management
- Platform-specific

**Implementation Example**:

```c
// Pseudo-code for manual containerization
unshare(CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET);
chroot("/var/cronium/roots/event-123");
setrlimit(RLIMIT_CPU, {.rlim_cur = 30, .rlim_max = 30});
setrlimit(RLIMIT_AS, {.rlim_cur = 512*1024*1024});
execve("/bin/sh", ["sh", "script.sh"], envp);
```

## Resource Management Strategies

### CPU Allocation

**Options**:

1. **Hard Limits**: Fixed CPU quota per container
2. **Soft Limits**: Burstable CPU with baseline guarantee
3. **Priority-Based**: CPU shares based on user tier
4. **Dynamic**: Adjust based on system load

**Recommendation**: Soft limits with tier-based baselines

```yaml
cpu_allocation:
  free_tier:
    guaranteed: 0.1
    burst: 0.5
    period: 100000us
  pro_tier:
    guaranteed: 0.5
    burst: 2.0
  enterprise:
    guaranteed: 2.0
    burst: 8.0
```

### Memory Management

**Considerations**:

- Prevent OOM kills of critical processes
- Allow for language-specific requirements (JVM heap, Node.js max-old-space)
- Consider caching needs

**Strategy**:

```yaml
memory_limits:
  hard_limit: user.tier.memory_limit
  soft_limit: hard_limit * 0.8
  swap: 0 # Disable swap for predictable performance
  oom_kill_disable: false
  oom_score_adj: 500 # Make containers preferred OOM targets
```

### Disk I/O

**Options**:

1. **Temporary filesystems only** (tmpfs)
2. **Persistent volumes** with quotas
3. **Copy-on-write layers**
4. **Network storage** for shared data

**Recommendation**: Tmpfs for execution, optional persistent volumes

```yaml
storage:
  execution:
    type: tmpfs
    size: 100Mi
    mount: /tmp
  persistent:
    type: volume
    size: 1Gi
    mount: /data
    per_user: true
```

### Network Isolation

**Security Levels**:

1. **No Network**: Complete isolation
2. **Egress Only**: Can make outbound connections
3. **Internal Only**: Can access internal services
4. **Full Access**: No restrictions

**Configuration**:

```yaml
network_policies:
  default: egress_only
  allowed_domains:
    - "*.amazonaws.com"
    - "api.github.com"
  blocked_ports: [25, 587] # Prevent spam
  bandwidth_limit: 10Mbps
```

## Data Exchange Mechanisms

### Current: File-Based

**Problems with current approach in containers**:

- Requires shared filesystem or copying files
- Inefficient for large data
- Cleanup complexity

### Option 1: Stdin/Stdout Pipes

**Pros**:

- No filesystem dependency
- Streaming support
- Simple and secure

**Cons**:

- Limited to sequential data flow
- No random access
- Size limitations

**Implementation**:

```javascript
const input = JSON.stringify({ ...eventData });
const proc = spawn("docker", ["run", "--rm", image], {
  stdio: ["pipe", "pipe", "pipe"],
});
proc.stdin.write(input);
proc.stdin.end();
```

### Option 2: Shared Memory

**Pros**:

- Very fast data exchange
- Good for large datasets
- Supports concurrent access

**Cons**:

- Complex to implement
- Platform-specific
- Security considerations

### Option 3: Environment Variables

**Pros**:

- Simple to implement
- Secure by default
- Cross-platform

**Cons**:

- Size limitations
- String-only data
- No complex structures

### Option 4: API-Based

**Pros**:

- Clean abstraction
- Supports large data
- Enables streaming
- Audit trail

**Cons**:

- Higher latency
- Requires API server in container
- More complex

**Implementation**:

```javascript
// Container runtime starts with API token
container.env.CRONIUM_API_TOKEN = generateToken();
container.env.CRONIUM_API_URL = "http://host.docker.internal:3001/api";

// Inside container
const data = await fetch(`${CRONIUM_API_URL}/execution/${EXECUTION_ID}/input`, {
  headers: { Authorization: `Bearer ${CRONIUM_API_TOKEN}` },
}).then((r) => r.json());
```

## Image Management

### Base Images

**Options**:

1. **Minimal Alpine**: ~5MB base, security focused
2. **Distroless**: Only app and runtime dependencies
3. **Ubuntu/Debian**: Full featured but larger
4. **Custom**: Purpose-built for Cronium

**Layering Strategy**:

```dockerfile
# Base layer - rarely changes
FROM alpine:3.18 AS base
RUN apk add --no-cache curl jq

# Runtime layers - language specific
FROM base AS node-runtime
RUN apk add --no-cache nodejs npm

FROM base AS python-runtime
RUN apk add --no-cache python3 py3-pip

FROM base AS bash-runtime
RUN apk add --no-cache bash coreutils
```

### User-Provided Dependencies

**Options**:

1. **Pre-built images**: Users specify image in event config
2. **Dynamic installation**: Install deps at runtime
3. **Layered approach**: User layer on top of base
4. **Package manifest**: Declarative dependency list

**Security Considerations**:

- Scan images for vulnerabilities
- Restrict registry access
- Sign and verify images
- Regular base image updates

## Security Considerations

### Privilege Levels

```yaml
security_profiles:
  strict:
    user: nobody
    readonly_root: true
    no_new_privileges: true
    drop_capabilities: ["ALL"]
    seccomp: "runtime/default"
    apparmor: "runtime/default"

  standard:
    user: "cronium"
    readonly_root: false
    drop_capabilities: ["NET_ADMIN", "SYS_ADMIN"]

  trusted:
    user: "cronium"
    additional_capabilities: ["NET_BIND_SERVICE"]
```

### Secret Management

**Options**:

1. **Environment variables**: Simple but visible in process list
2. **Mounted files**: More secure, requires volume management
3. **Secret service**: External secret management (Vault, AWS Secrets)
4. **Encrypted variables**: App-level encryption

**Recommendation**: Hybrid approach

```javascript
// Sensitive secrets via mounted files
/run/secrets/
  ├── api_keys.json
  └── credentials.json

// Non-sensitive config via env
process.env.CRONIUM_EVENT_ID
process.env.CRONIUM_USER_ID
```

## Performance Optimization

### Container Startup Time

**Optimization Strategies**:

1. **Pre-pulled images**: Cache common images on all nodes
2. **Warm pool**: Keep containers ready but paused
3. **Lazy loading**: Start container while preparing execution
4. **Image optimization**: Minimize layers and size

**Benchmark Goals**:

- Cold start: < 2 seconds
- Warm start: < 500ms
- Execution overhead: < 10%

### Resource Pooling

```javascript
class ContainerPool {
  constructor(options) {
    this.minSize = options.minSize || 5;
    this.maxSize = options.maxSize || 50;
    this.idleTimeout = options.idleTimeout || 300000;
    this.containers = new Map();
  }

  async acquire(requirements) {
    // Find available container matching requirements
    // Or create new one if under limit
    // Return container handle
  }

  async release(container) {
    // Clean up container
    // Return to pool or destroy
  }
}
```

## Monitoring and Debugging

### Metrics to Track

```yaml
container_metrics:
  performance:
    - startup_time
    - execution_time
    - queuing_time
  resources:
    - cpu_usage
    - memory_usage
    - disk_io
    - network_io
  reliability:
    - success_rate
    - timeout_rate
    - oom_kills
    - crash_rate
```

### Debug Access

**Options**:

1. **Container preservation**: Keep failed containers for inspection
2. **Debug mode**: Interactive shell access
3. **Trace collection**: Automatic debug info gathering
4. **Remote debugging**: Port forwarding for debuggers

## User Experience Considerations

### Transparency

Users should understand:

- What resources their scripts have access to
- Current resource usage
- Why executions might be queued or limited
- How to optimize their scripts

### Customization Options

```yaml
user_preferences:
  execution_environment:
    base_image: "cronium/node:18"
    additional_packages: ["axios", "lodash"]
    environment_variables:
      NODE_OPTIONS: "--max-old-space-size=256"
    persistent_workspace: true
    network_access: "full"
```

### Migration Path

For existing users:

1. **Compatibility mode**: Initial containers mimic current behavior
2. **Gradual restrictions**: Slowly introduce limits
3. **Opt-in features**: Let users enable strict isolation
4. **Clear documentation**: Explain changes and benefits

## Implementation Roadmap

### Phase 1: MVP (Month 1)

- Docker-based per-event containers
- Basic resource limits
- File-based data exchange
- No network restrictions

### Phase 2: Security (Month 2)

- Strict security profiles
- Network policies
- Secret management
- Image scanning

### Phase 3: Performance (Month 3)

- Container pooling
- Startup optimization
- Resource monitoring
- Auto-scaling

### Phase 4: Advanced Features (Month 4+)

- User customization
- Persistent workspaces
- Debug capabilities
- Multi-region support

## Decision Recommendations

Based on this analysis, here are my recommendations:

### 1. Container Technology

**Recommendation**: Docker with Podman as future option

- Docker provides the best ecosystem and tooling
- Plan for Podman migration for daemonless architecture
- Avoid platform-specific solutions initially

### 2. Execution Model

**Recommendation**: Hybrid approach

- Default: Per-event containers for security
- Opt-in: Container pooling for high-frequency events
- Future: User-dedicated containers for enterprise

### 3. Resource Management

**Recommendation**: Tiered soft limits

- CPU: Burstable with guaranteed baseline
- Memory: Hard limits with tier-based allocation
- Disk: Tmpfs with optional persistent volumes
- Network: Egress-only by default

### 4. Data Exchange

**Recommendation**: API-based with stdin/stdout fallback

- Primary: REST API for data exchange
- Fallback: Stdin/stdout for simple scripts
- Future: Shared memory for performance

### 5. Security Profile

**Recommendation**: Strict by default

- Run as nobody user
- Read-only root filesystem
- Drop all capabilities
- Network isolation

## Open Questions

1. **Cost Model**: How do we charge for container resources?
2. **Multi-tenancy**: Shared infrastructure or dedicated clusters?
3. **Compliance**: What certifications do we need?
4. **Disaster Recovery**: How do we handle container failures?
5. **Geographic Distribution**: Run containers near users?

## Next Steps

1. Create proof-of-concept with Docker
2. Benchmark performance vs current model
3. Design detailed API for container management
4. Plan migration strategy for existing events
5. Create user documentation and examples

This brainstorming document should evolve as we prototype and learn more about the practical implications of each approach.
