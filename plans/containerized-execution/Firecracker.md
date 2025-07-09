# Firecracker-based Execution Architecture for Cronium

## Executive Summary

This document outlines a vision for implementing Cronium's containerized execution using AWS Firecracker microVMs. Firecracker offers a unique combination of strong security isolation, minimal overhead, and fast startup times that makes it ideal for executing untrusted user code at scale.

## Why Firecracker?

### Key Advantages

1. **Sub-125ms boot times**: Near-instantaneous VM startup enables true on-demand execution
2. **Minimal overhead**: ~5MB memory overhead per microVM vs ~100MB+ for containers
3. **Strong isolation**: Hardware-level isolation via KVM virtualization
4. **Purpose-built for serverless**: Powers AWS Lambda, designed for multi-tenant workloads
5. **Resource efficiency**: Can run thousands of microVMs per host

### Comparison with Container Approach

| Aspect            | Docker Container  | Firecracker microVM     |
| ----------------- | ----------------- | ----------------------- |
| Startup Time      | 1-2 seconds       | <125ms                  |
| Memory Overhead   | ~100MB            | ~5MB                    |
| Isolation Level   | Kernel namespaces | Hardware virtualization |
| Resource Limits   | cgroups (soft)    | Hardware enforced       |
| Network Isolation | iptables rules    | Virtual network devices |
| Storage           | Shared kernel FS  | Isolated block devices  |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Cronium API Server                        │
├─────────────────────────────────────────────────────────────┤
│                  Execution Orchestrator                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   Scheduler  │  │ microVM Pool │  │ Resource Manager│   │
│  └─────────────┘  └──────────────┘  └─────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    Firecracker Layer                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ microVM #1 │  │ microVM #2 │  │ microVM #3 │  ...      │
│  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │           │
│  │ │ Script │ │  │ │ Script │ │  │ │ Script │ │           │
│  │ │Executor│ │  │ │Executor│ │  │ │Executor│ │           │
│  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │           │
│  └────────────┘  └────────────┘  └────────────┘           │
├─────────────────────────────────────────────────────────────┤
│                    KVM Hypervisor                           │
├─────────────────────────────────────────────────────────────┤
│                    Host Operating System                     │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. MicroVM Manager

Responsible for lifecycle management of Firecracker microVMs.

```typescript
interface MicroVMConfig {
  vcpuCount: number;
  memSizeMib: number;
  kernelImagePath: string;
  rootfsPath: string;
  networkInterfaces?: NetworkInterface[];
  drives?: Drive[];
}

class MicroVMManager {
  private readonly firecrackerBinary: string;
  private readonly socketDirectory: string;
  private activeVMs: Map<string, MicroVM>;

  async createMicroVM(config: MicroVMConfig): Promise<MicroVM> {
    const vmId = generateVMId();
    const socketPath = path.join(this.socketDirectory, `${vmId}.sock`);

    // Start Firecracker process
    const fcProcess = spawn(this.firecrackerBinary, [
      "--api-sock",
      socketPath,
      "--id",
      vmId,
      "--log-path",
      `/var/log/firecracker/${vmId}.log`,
      "--level",
      "Warning",
      "--show-log-origin",
    ]);

    // Wait for API socket
    await this.waitForSocket(socketPath);

    // Configure microVM via API
    const vm = new MicroVM(vmId, socketPath, fcProcess);
    await vm.configure(config);

    this.activeVMs.set(vmId, vm);
    return vm;
  }

  async destroyMicroVM(vmId: string): Promise<void> {
    const vm = this.activeVMs.get(vmId);
    if (!vm) return;

    await vm.stop();
    this.activeVMs.delete(vmId);
  }
}
```

### 2. Execution Environment

Minimal Linux environment optimized for script execution.

```dockerfile
# Firecracker rootfs build
FROM alpine:3.18 AS rootfs

# Install base utilities and runtimes
RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    nodejs \
    python3 \
    jq \
    # Cronium runtime helpers
    && mkdir -p /opt/cronium/runtime

# Copy runtime helpers
COPY runtime-helpers /opt/cronium/runtime/

# Create execution user
RUN adduser -D -u 1000 cronium \
    && mkdir -p /workspace \
    && chown -R cronium:cronium /workspace

# Configure init system
COPY init.sh /init
RUN chmod +x /init

# Export as rootfs
RUN mkdir /rootfs && \
    tar -C / --exclude=/rootfs -cf /rootfs/rootfs.tar .
```

### 3. Resource Allocation Strategy

Dynamic resource allocation based on user tier and workload.

```typescript
interface ResourceProfile {
  vcpus: number;
  memory: number;
  disk: number;
  network: {
    ingressBandwidth: number;
    egressBandwidth: number;
  };
  executionTimeout: number;
}

const RESOURCE_PROFILES: Record<UserTier, ResourceProfile> = {
  free: {
    vcpus: 1,
    memory: 128, // MB
    disk: 100, // MB
    network: {
      ingressBandwidth: 10, // Mbps
      egressBandwidth: 10, // Mbps
    },
    executionTimeout: 30, // seconds
  },
  pro: {
    vcpus: 2,
    memory: 512,
    disk: 500,
    network: {
      ingressBandwidth: 100,
      egressBandwidth: 100,
    },
    executionTimeout: 300,
  },
  enterprise: {
    vcpus: 4,
    memory: 2048,
    disk: 2048,
    network: {
      ingressBandwidth: 1000,
      egressBandwidth: 1000,
    },
    executionTimeout: 3600,
  },
};
```

### 4. Network Architecture

Isolated network per microVM with controlled egress.

```typescript
class NetworkManager {
  private readonly tapDevicePool: TapDevicePool;
  private readonly iptables: IPTablesManager;

  async setupNetwork(
    vmId: string,
    config: NetworkConfig,
  ): Promise<NetworkSetup> {
    // Allocate TAP device from pool
    const tapDevice = await this.tapDevicePool.allocate();

    // Configure network namespace
    const namespace = `vm-${vmId}`;
    await this.createNetworkNamespace(namespace);

    // Setup NAT and firewall rules
    await this.iptables.setupVMRules({
      vmId,
      tapDevice,
      allowedPorts: config.allowedPorts,
      blockedDomains: config.blockedDomains,
      bandwidthLimit: config.bandwidthLimit,
    });

    return {
      tapDevice,
      ipAddress: this.allocateIP(vmId),
      gateway: this.gatewayIP,
      dns: this.dnsServers,
    };
  }
}
```

### 5. Data Exchange Layer

High-performance data exchange using virtio-vsock.

```typescript
interface DataExchange {
  sendInput(vmId: string, data: any): Promise<void>;
  receiveOutput(vmId: string): Promise<any>;
  streamLogs(vmId: string): AsyncIterator<string>;
}

class VsockDataExchange implements DataExchange {
  private readonly vsockPort = 3000;

  async sendInput(vmId: string, data: any): Promise<void> {
    const vm = this.vmManager.getVM(vmId);
    const vsockCID = await vm.getVsockCID();

    // Connect to VM via vsock
    const socket = net.createConnection({
      host: vsockCID,
      port: this.vsockPort,
      family: "vsock",
    });

    // Send serialized data
    const payload = JSON.stringify(data);
    socket.write(`${payload.length}\n${payload}`);
    socket.end();
  }

  async receiveOutput(vmId: string): Promise<any> {
    // Set up vsock listener for output
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString();
        });
        socket.on("end", () => {
          try {
            resolve(JSON.parse(buffer));
          } catch (e) {
            reject(e);
          }
        });
      });

      server.listen(this.vsockPort + 1, vsockCID);
    });
  }
}
```

### 6. MicroVM Pool Management

Pre-warmed microVM pool for instant execution.

```typescript
class MicroVMPool {
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly profiles: Map<string, ResourceProfile>;
  private readonly pools: Map<string, MicroVM[]>;

  constructor(config: PoolConfig) {
    this.minSize = config.minSize;
    this.maxSize = config.maxSize;
    this.profiles = new Map(Object.entries(config.profiles));
    this.pools = new Map();

    // Initialize pools
    for (const [tier, profile] of this.profiles) {
      this.pools.set(tier, []);
      this.maintainPool(tier, profile);
    }
  }

  async acquire(tier: UserTier): Promise<MicroVM> {
    const pool = this.pools.get(tier);
    if (!pool || pool.length === 0) {
      // Create on-demand if pool is empty
      return this.createVM(tier);
    }

    const vm = pool.pop()!;

    // Trigger background replenishment
    setImmediate(() => this.maintainPool(tier));

    return vm;
  }

  async release(vm: MicroVM, tier: UserTier): Promise<void> {
    // Reset VM state
    await this.resetVM(vm);

    const pool = this.pools.get(tier)!;
    if (pool.length < this.maxSize) {
      pool.push(vm);
    } else {
      await this.vmManager.destroyMicroVM(vm.id);
    }
  }

  private async maintainPool(tier: string): Promise<void> {
    const pool = this.pools.get(tier)!;
    const profile = this.profiles.get(tier)!;

    while (pool.length < this.minSize) {
      const vm = await this.createVM(tier);
      pool.push(vm);
    }
  }
}
```

## Implementation Phases

### Phase 1: Foundation (Weeks 1-4)

1. **Firecracker Integration**
   - Install and configure Firecracker
   - Create basic microVM manager
   - Build minimal rootfs image
   - Implement basic lifecycle management

2. **Execution Runtime**
   - Port runtime helpers to microVM environment
   - Implement vsock-based data exchange
   - Create execution wrapper

### Phase 2: Resource Management (Weeks 5-8)

1. **Resource Profiles**
   - Implement tier-based resource allocation
   - Add CPU/memory/disk limits
   - Network bandwidth shaping

2. **Pool Management**
   - Create microVM pool
   - Implement pre-warming
   - Add pool auto-scaling

### Phase 3: Security & Isolation (Weeks 9-12)

1. **Network Security**
   - Implement network namespaces
   - Add firewall rules
   - DNS filtering

2. **Storage Isolation**
   - Per-VM ephemeral storage
   - Optional persistent volumes
   - Quota enforcement

### Phase 4: Performance & Scale (Weeks 13-16)

1. **Optimization**
   - Kernel tuning
   - Boot time optimization
   - Memory deduplication

2. **Monitoring**
   - Resource usage tracking
   - Performance metrics
   - Health monitoring

## Challenges and Mitigations

### 1. Linux/KVM Dependency

**Challenge**: Firecracker requires Linux with KVM support, limiting deployment options.

**Mitigation**:

- Primary deployment on Linux hosts
- Fallback to Docker for development/testing
- Clear documentation on system requirements

### 2. Initial Implementation Complexity

**Challenge**: Firecracker requires more low-level configuration than containers.

**Mitigation**:

- Build abstraction layer early
- Extensive testing framework
- Gradual rollout with feature flags

### 3. Debugging Experience

**Challenge**: Debugging inside microVMs is more complex than containers.

**Mitigation**:

- Enhanced logging via vsock
- Debug mode with SSH access
- Snapshot support for investigation

### 4. Image Management

**Challenge**: No Docker-style image registry for Firecracker.

**Mitigation**:

- Build custom rootfs management system
- Use S3/object storage for distribution
- Implement versioning and rollback

## Performance Projections

Based on Firecracker benchmarks and our architecture:

| Metric                     | Current (Direct) | Docker | Firecracker |
| -------------------------- | ---------------- | ------ | ----------- |
| Cold Start                 | 10ms             | 1-2s   | 125ms       |
| Warm Start                 | 10ms             | 200ms  | 25ms        |
| Memory per Execution       | Shared           | ~100MB | ~5MB        |
| Concurrent Executions/Host | 100s             | 100s   | 1000s       |
| Isolation Level            | None             | Medium | High        |

## Cost Analysis

### Infrastructure Costs (per host)

```
Host: c5.metal (96 vCPUs, 192 GB RAM)
Cost: ~$4.08/hour

Capacity:
- Docker: ~500 concurrent containers
- Firecracker: ~3000 concurrent microVMs

Cost per execution:
- Docker: $0.008/execution-hour
- Firecracker: $0.0014/execution-hour

Savings: ~82% reduction in infrastructure costs
```

## Security Benefits

1. **Hardware-level isolation**: Each execution in separate VM
2. **No shared kernel**: Eliminates container escape risks
3. **Resource enforcement**: Hardware-enforced limits
4. **Network isolation**: True network segmentation per VM
5. **Minimal attack surface**: Custom minimal kernel

## Conclusion

Firecracker provides an ideal foundation for Cronium's containerized execution needs, offering:

- **Superior isolation** without sacrificing performance
- **Cost efficiency** through higher density
- **Fast startup** enabling true on-demand execution
- **Strong security** suitable for multi-tenant environments

While implementation complexity is higher than containers, the benefits in security, performance, and cost make Firecracker the optimal choice for Cronium's evolution into a production-ready platform for executing untrusted user code at scale.
