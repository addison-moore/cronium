# Local Container Execution Implementation Plan

## Overview

This plan details the implementation of a unified execution model where all script execution (both local and remote) goes through the server abstraction. The "Local Execution" will be a Docker container that appears as just another server option, eliminating the current LOCAL/REMOTE distinction.

## Goals

1. **Unify execution model**: Remove LOCAL/REMOTE distinction, everything is a "server"
2. **Containerize local execution**: Use Docker containers for security and isolation
3. **Simplify UI/UX**: Single server selection interface for all executions
4. **Improve security**: No more direct host execution
5. **Admin control**: Admins control who can use local execution

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Compose                         │
├─────────────────────────┬───────────────────────────────┤
│                         │                               │
│    Cronium App          │    Local Execution           │
│    Container            │    Container                 │
│                         │                               │
│  - Next.js App          │  - Script Execution Env      │
│  - API/tRPC             │  - Isolated & Secure         │
│  - WebSockets           │  - Resource Limited          │
│  - Database             │  - Multi-language Support    │
│                         │                               │
└─────────────────────────┴───────────────────────────────┘
                          │
                          │ Docker Network
                          │
                    ┌─────▼─────┐
                    │   Neon    │
                    │ Database  │
                    └───────────┘
```

## Phase 1: Docker Compose Setup

### docker-compose.yml

```yaml
version: "3.8"

services:
  # Main Cronium application
  cronium:
    build: .
    container_name: cronium-app
    ports:
      - "5001:5001" # Next.js app
      - "3001:3001" # WebSocket server
    environment:
      DATABASE_URL: ${DATABASE_URL}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-http://localhost:5001}
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      # Local execution container configuration
      LOCAL_EXEC_CONTAINER: cronium-executor
      LOCAL_EXEC_NETWORK: cronium-network
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro # Docker access for container management
      - cronium-data:/data
    networks:
      - cronium-network
    depends_on:
      - executor
    restart: unless-stopped

  # Local execution container
  executor:
    build:
      context: ./docker/executor
      dockerfile: Dockerfile
    container_name: cronium-executor
    hostname: local-executor
    environment:
      EXECUTOR_MODE: container
      EXECUTOR_ID: local-001
    volumes:
      - executor-tmp:/tmp
      - executor-workspace:/workspace
    networks:
      - cronium-network
    cap_drop:
      - ALL
    cap_add:
      - DAC_OVERRIDE # File operations
      - CHOWN # Change file ownership
    security_opt:
      - no-new-privileges:true
      - seccomp:./docker/executor/seccomp-profile.json
    read_only: true
    tmpfs:
      - /tmp:size=100M,mode=1777
      - /var/tmp:size=50M,mode=1777
    restart: unless-stopped
    # Resource limits
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2G
        reservations:
          cpus: "0.5"
          memory: 512M

volumes:
  cronium-data:
  executor-tmp:
  executor-workspace:

networks:
  cronium-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.30.0.0/16
```

### Executor Dockerfile

```dockerfile
# docker/executor/Dockerfile
FROM alpine:3.18

# Install runtime dependencies
RUN apk add --no-cache \
    # Core utilities
    bash \
    coreutils \
    curl \
    jq \
    # Python runtime
    python3 \
    py3-pip \
    # Node.js runtime
    nodejs \
    npm \
    # Process management
    tini \
    # SSH client for acting as jump host
    openssh-client \
    && rm -rf /var/cache/apk/*

# Create non-root user for execution
RUN addgroup -g 1000 cronium && \
    adduser -D -u 1000 -G cronium -s /bin/bash cronium

# Setup directories
RUN mkdir -p /workspace /tmp/cronium /var/run/cronium && \
    chown -R cronium:cronium /workspace /tmp/cronium /var/run/cronium

# Copy runtime helpers
COPY runtime-helpers/ /opt/cronium/runtime-helpers/
RUN chmod -R 755 /opt/cronium/runtime-helpers

# Copy execution wrapper script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER cronium
WORKDIR /workspace

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/docker-entrypoint.sh"]
```

## Phase 2: Unified Server Model

### Database Schema Changes

```sql
-- Remove runLocation from events table
ALTER TABLE events DROP COLUMN "runLocation";

-- Add server type to distinguish execution methods
ALTER TABLE servers ADD COLUMN "type" TEXT DEFAULT 'ssh';
ALTER TABLE servers ADD COLUMN "isSystemManaged" BOOLEAN DEFAULT false;
ALTER TABLE servers ADD COLUMN "containerConfig" JSONB;

-- Add constraint to ensure container servers have proper config
ALTER TABLE servers ADD CONSTRAINT container_config_check
  CHECK (type != 'container' OR containerConfig IS NOT NULL);

-- Create system setting for local execution access
INSERT INTO "systemSettings" (key, value, description)
VALUES (
  'local_execution_access',
  'admin_only',
  'Controls who can use local execution: admin_only, all_users, disabled'
);

-- Create the system-managed local execution server
INSERT INTO servers (
  name,
  ip,
  port,
  username,
  type,
  isSystemManaged,
  containerConfig,
  userId
) VALUES (
  'Local Execution',
  'cronium-executor',
  22,
  'cronium',
  'container',
  true,
  '{
    "containerName": "cronium-executor",
    "networkName": "cronium-network",
    "executionPath": "/workspace",
    "maxConcurrentJobs": 10,
    "resourceLimits": {
      "cpu": 2.0,
      "memory": "2G",
      "disk": "1G"
    }
  }'::jsonb,
  NULL  -- System-managed, no specific owner
);
```

### Server Interface Abstraction

```typescript
// src/lib/execution/server-executor.ts
export interface ServerExecutor {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeScript(script: ScriptExecutionRequest): Promise<ScriptExecutionResult>;
  checkHealth(): Promise<boolean>;
  getResourceUsage(): Promise<ResourceUsage>;
}

// SSH implementation (existing)
export class SSHServerExecutor implements ServerExecutor {
  // Current SSH implementation
}

// Container implementation (new)
export class ContainerServerExecutor implements ServerExecutor {
  private dockerClient: Docker;
  private containerName: string;

  async executeScript(
    request: ScriptExecutionRequest,
  ): Promise<ScriptExecutionResult> {
    // Use docker exec to run scripts in the container
    const exec = await this.dockerClient.getContainer(this.containerName).exec({
      Cmd: ["bash", "-c", this.wrapScript(request)],
      WorkingDir: "/workspace",
      Env: this.buildEnvironment(request),
      AttachStdout: true,
      AttachStderr: true,
    });

    // Stream output and handle results
    return this.processExecution(exec);
  }
}

// Factory to create appropriate executor
export function createServerExecutor(server: Server): ServerExecutor {
  switch (server.type) {
    case "ssh":
      return new SSHServerExecutor(server);
    case "container":
      return new ContainerServerExecutor(server);
    default:
      throw new Error(`Unknown server type: ${server.type}`);
  }
}
```

## Phase 3: UI/UX Changes

### Server Selection Component Updates

```typescript
// src/components/servers/ServerSelector.tsx
export function ServerSelector({
  selectedServers,
  onChange,
  allowMultiple = true
}: ServerSelectorProps) {
  const { data: servers } = api.servers.getAvailable.useQuery();

  // No more LOCAL/REMOTE toggle
  // Just show all available servers including "Local Execution"

  return (
    <div className="space-y-2">
      <Label>Execution Servers</Label>
      <MultiSelect
        options={servers?.map(s => ({
          value: s.id,
          label: s.name,
          icon: s.type === 'container' ? <ContainerIcon /> : <ServerIcon />
        }))}
        selected={selectedServers}
        onChange={onChange}
        placeholder="Select execution servers..."
      />
    </div>
  );
}
```

### Event Form Simplification

```typescript
// src/components/event-form/EventForm.tsx
// Remove runLocation field entirely
// Just use server selection

<FormField
  control={form.control}
  name="serverIds"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Execution Servers</FormLabel>
      <FormControl>
        <ServerSelector
          selectedServers={field.value || []}
          onChange={field.onChange}
          allowMultiple={true}
        />
      </FormControl>
      <FormDescription>
        Select one or more servers where this event will execute
      </FormDescription>
    </FormItem>
  )}
/>
```

## Phase 4: Admin Controls

### Settings Page Addition

```typescript
// src/app/admin/settings/execution/page.tsx
export default function ExecutionSettings() {
  const [settings, setSettings] = useState({
    localExecutionAccess: 'admin_only',
    localExecutionResourceLimits: {
      cpu: 2.0,
      memory: '2G',
      maxConcurrentJobs: 10
    }
  });

  return (
    <SettingsLayout>
      <SettingsSection title="Local Execution Environment">
        <RadioGroup
          value={settings.localExecutionAccess}
          onValueChange={(value) => updateSetting('local_execution_access', value)}
        >
          <RadioItem value="disabled">
            Disabled - No local execution
          </RadioItem>
          <RadioItem value="admin_only">
            Admin Only - Only administrators can use local execution
          </RadioItem>
          <RadioItem value="all_users">
            All Users - Any user can use local execution
          </RadioItem>
        </RadioGroup>

        <ResourceLimitsForm
          limits={settings.localExecutionResourceLimits}
          onChange={updateResourceLimits}
        />
      </SettingsSection>
    </SettingsLayout>
  );
}
```

### Access Control Implementation

```typescript
// src/server/api/routers/servers.ts
export const serversRouter = createTRPCRouter({
  getAvailable: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx.session;

    // Get user's own servers and shared servers
    const userServers = await ctx.db.query.servers.findMany({
      where: or(
        eq(servers.userId, user.id),
        inArray(
          servers.id,
          ctx.db
            .select({ serverId: serverShares.serverId })
            .from(serverShares)
            .where(eq(serverShares.sharedWithUserId, user.id)),
        ),
      ),
    });

    // Check if user can access local execution
    const localExecutionAccess = await getSystemSetting(
      "local_execution_access",
    );
    const canUseLocal =
      localExecutionAccess === "all_users" ||
      (localExecutionAccess === "admin_only" && user.role === "ADMIN");

    if (canUseLocal) {
      // Add the system-managed local execution server
      const localServer = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.isSystemManaged, true),
          eq(servers.type, "container"),
        ),
      });

      if (localServer) {
        userServers.push(localServer);
      }
    }

    return userServers;
  }),
});
```

## Phase 5: Migration Strategy

### Step 1: Database Migration

```typescript
// drizzle/0003_unified_execution_model.ts
export async function up(db: Database) {
  // Create local execution server
  const [localServer] = await db
    .insert(servers)
    .values({
      name: "Local Execution",
      ip: "cronium-executor",
      port: 22,
      username: "cronium",
      type: "container",
      isSystemManaged: true,
      containerConfig: {
        containerName: "cronium-executor",
        // ... config
      },
    })
    .returning();

  // Migrate existing LOCAL events to use the local server
  const localEvents = await db
    .select()
    .from(events)
    .where(eq(events.runLocation, "LOCAL"));

  for (const event of localEvents) {
    await db.insert(eventServers).values({
      eventId: event.id,
      serverId: localServer.id,
    });
  }

  // Remove runLocation column
  await db.execute(sql`ALTER TABLE events DROP COLUMN "runLocation"`);
}
```

### Step 2: Code Migration

1. **Update execution logic**:
   - Replace `executeLocalScript` with container execution
   - Remove runLocation checks
   - Use unified server executor

2. **Update UI components**:
   - Remove LOCAL/REMOTE toggles
   - Update forms to use server selection only
   - Add server type indicators

3. **Update API endpoints**:
   - Remove runLocation from schemas
   - Update validation to require at least one server
   - Add access control for local execution

## Phase 6: Monitoring and Management

### Container Health Monitoring

```typescript
// src/lib/monitoring/container-monitor.ts
export class ContainerMonitor {
  async checkHealth(): Promise<HealthStatus> {
    const container = this.docker.getContainer("cronium-executor");
    const stats = await container.stats({ stream: false });

    return {
      healthy: container.State.Running,
      cpu: this.calculateCPUUsage(stats),
      memory: this.calculateMemoryUsage(stats),
      diskUsage: await this.checkDiskUsage(),
      activeJobs: await this.getActiveJobCount(),
    };
  }

  async enforceResourceLimits() {
    // Monitor and enforce resource limits
    // Kill jobs exceeding limits
    // Alert on resource exhaustion
  }
}
```

### Admin Dashboard Addition

```typescript
// src/app/admin/execution/page.tsx
export default function ExecutionMonitor() {
  const { data: health } = api.execution.getHealth.useQuery(
    undefined,
    { refetchInterval: 5000 }
  );

  return (
    <Dashboard>
      <MetricCard
        title="Local Execution Health"
        value={health?.healthy ? 'Healthy' : 'Unhealthy'}
        trend={health?.activeJobs}
      />

      <ResourceUsageChart
        cpu={health?.cpu}
        memory={health?.memory}
        disk={health?.diskUsage}
      />

      <ActiveJobsList jobs={health?.activeJobs} />
    </Dashboard>
  );
}
```

## Implementation Timeline

### Week 1: Foundation

- [ ] Create Docker Compose configuration
- [ ] Build executor container image
- [ ] Test basic container execution
- [ ] Implement ContainerServerExecutor

### Week 2: Database & API

- [ ] Run database migrations
- [ ] Update server models and schemas
- [ ] Implement unified execution API
- [ ] Add access control logic

### Week 3: UI Updates

- [ ] Remove LOCAL/REMOTE UI elements
- [ ] Update server selection components
- [ ] Migrate event and workflow forms
- [ ] Add server type indicators

### Week 4: Testing & Polish

- [ ] Comprehensive testing
- [ ] Performance optimization
- [ ] Documentation updates
- [ ] Migration guide for users

## Security Considerations

1. **Container Isolation**:
   - Read-only root filesystem
   - Dropped capabilities
   - Seccomp profiles
   - Resource limits

2. **Network Security**:
   - Isolated Docker network
   - No external network access by default
   - Controlled egress rules

3. **Data Protection**:
   - Temporary file cleanup
   - No persistent storage between executions
   - Encrypted variables in transit

## Performance Optimization

1. **Container Reuse**:
   - Keep container running between executions
   - Fast execution without startup overhead
   - Periodic cleanup of workspace

2. **Resource Management**:
   - CPU and memory limits
   - Concurrent job limits
   - Queue management for overload

3. **Monitoring**:
   - Real-time resource usage
   - Performance metrics
   - Alerting on issues

## Rollback Plan

If issues arise:

1. **Feature Flag**: Add `ENABLE_UNIFIED_EXECUTION` flag
2. **Dual Mode**: Support both old and new execution paths temporarily
3. **Gradual Migration**: Migrate users in batches
4. **Quick Revert**: Database changes are reversible

## Success Metrics

1. **Security**: Zero host compromise incidents
2. **Performance**: <500ms execution overhead
3. **Reliability**: 99.9% execution success rate
4. **Adoption**: 100% of events using unified model within 30 days

## Next Steps

1. Review and approve this plan
2. Set up development environment with Docker Compose
3. Create executor container image
4. Begin implementation following the timeline

This unified execution model will significantly improve Cronium's security posture while simplifying the codebase and user experience.
