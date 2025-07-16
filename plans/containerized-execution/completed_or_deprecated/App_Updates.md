# Cronium Application Updates for Containerized Execution

## Overview

This document details all the changes required in the main Cronium Next.js application to migrate from direct host execution to containerized execution using the orchestrator. The migration will improve security, reliability, and scalability while maintaining all existing functionality.

## Current Architecture Issues

### Security Vulnerabilities

1. **Direct Host Execution**: Scripts run with full system access
2. **No Resource Limits**: Scripts can consume unlimited CPU/memory
3. **Shared Environment**: Scripts can access each other's data
4. **No Network Isolation**: Full network access available

### Technical Limitations

1. **No Real-time Log Streaming**: Logs only available after execution
2. **Sequential Multi-server Execution**: Performance bottleneck
3. **In-memory Scheduler**: Jobs lost on restart
4. **File-based Runtime Helpers**: Security and scalability issues

## Backend Changes Required

### 1. API Routes Updates

#### Remove Direct Execution Endpoints

**Files to modify:**

- `src/app/api/cron/route.ts` - Remove direct execution logic
- `src/server/api/routers/events.ts` - Update `execute` mutation

**Changes:**

```typescript
// OLD: Direct execution
export const eventsRouter = router({
  execute: protectedProcedure.mutation(async ({ ctx, input }) => {
    // Direct execution code
    await executeScript(event);
  }),
});

// NEW: Create job in orchestrator
export const eventsRouter = router({
  execute: protectedProcedure.mutation(async ({ ctx, input }) => {
    // Create job for orchestrator
    const job = await createOrchestratorJob({
      eventId: input.eventId,
      type: event.type,
      execution: event.execution,
      userId: ctx.user.id,
    });

    return { jobId: job.id, status: "queued" };
  }),
});
```

#### Add Orchestrator Integration Endpoints

**New files to create:**

- `src/app/api/internal/jobs/queue/route.ts` - Job queue endpoint
- `src/app/api/internal/jobs/[id]/status/route.ts` - Status updates
- `src/app/api/internal/jobs/[id]/complete/route.ts` - Job completion

**Implementation:**

```typescript
// Job queue endpoint for orchestrator polling
export async function GET(request: Request) {
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.status, "pending"))
    .limit(10);

  return Response.json({ jobs });
}

// Job acknowledgment
export async function POST(request: Request) {
  const { jobId } = await request.json();

  await db
    .update(jobsTable)
    .set({
      status: "acknowledged",
      acknowledgedAt: new Date(),
    })
    .where(eq(jobsTable.id, jobId));

  return Response.json({ success: true });
}
```

### 2. Service Layer Updates

#### Remove Direct Execution Services

**Files to remove/deprecate:**

- `src/lib/scheduler/local-executor.ts` - Direct host execution
- `src/lib/scheduler/execute-script.ts` - Replace with job creation

#### Create Job Management Service

**New file:** `src/lib/services/job-service.ts`

```typescript
export class JobService {
  async createJob(params: CreateJobParams): Promise<Job> {
    const job = await db
      .insert(jobsTable)
      .values({
        id: generateId(),
        eventId: params.eventId,
        type: params.type,
        status: "pending",
        execution: params.execution,
        userId: params.userId,
        createdAt: new Date(),
      })
      .returning();

    return job[0];
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const job = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);

    return job[0]?.status || "unknown";
  }

  async updateJobStatus(jobId: string, status: JobStatus, data?: any) {
    await db
      .update(jobsTable)
      .set({
        status,
        updatedAt: new Date(),
        result: data,
      })
      .where(eq(jobsTable.id, jobId));
  }
}
```

#### Update Scheduler Service

**File:** `src/lib/scheduler/scheduler.ts`

```typescript
// OLD: Direct execution
private async executeEvent(event: Event) {
  await executeScript(event);
}

// NEW: Create job for orchestrator
private async executeEvent(event: Event) {
  const job = await this.jobService.createJob({
    eventId: event.id,
    type: 'event',
    execution: {
      script: event.script,
      environment: event.environment,
      target: event.target
    },
    userId: event.userId
  });

  // Track job for status updates
  this.trackJob(job.id, event.id);
}
```

### 3. WebSocket Updates

#### Add Real-time Log Streaming

**Update:** `server.ts`

```typescript
// Add new namespace for orchestrator logs
io.of("/logs").on("connection", (socket) => {
  socket.on("authenticate", async (token) => {
    const user = await validateToken(token);
    if (!user) {
      socket.disconnect();
      return;
    }

    socket.join(`user:${user.id}`);
  });

  socket.on("subscribe", (jobId) => {
    socket.join(`job:${jobId}`);
  });

  socket.on("unsubscribe", (jobId) => {
    socket.leave(`job:${jobId}`);
  });
});

// Handle orchestrator log messages
export function streamJobLog(jobId: string, logEntry: LogEntry) {
  io.of("/logs").to(`job:${jobId}`).emit("log", {
    jobId,
    timestamp: logEntry.timestamp,
    stream: logEntry.stream,
    line: logEntry.line,
  });
}
```

### 4. Database Schema Updates

**New migrations needed:**

```sql
-- Create jobs table
CREATE TABLE jobs (
  id VARCHAR(255) PRIMARY KEY,
  event_id VARCHAR(255),
  workflow_id VARCHAR(255),
  type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  execution JSONB NOT NULL,
  result JSONB,
  user_id VARCHAR(255) NOT NULL,
  orchestrator_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Add indexes
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);

-- Update execution_logs table
ALTER TABLE execution_logs
ADD COLUMN job_id VARCHAR(255),
ADD COLUMN log_data JSONB,
ADD FOREIGN KEY (job_id) REFERENCES jobs(id);
```

### 5. Runtime Helper Migration

#### Remove File-based Helpers

**Files to remove:**

- `src/runtime-helpers/cronium.js`
- `src/runtime-helpers/cronium.py`
- `src/runtime-helpers/cronium.sh`

#### Create Runtime API Client

**New file:** `src/lib/services/runtime-api.ts`

```typescript
export class RuntimeAPIService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.RUNTIME_API_URL!;
  }

  async getVariable(executionId: string, key: string) {
    const response = await fetch(
      `${this.baseUrl}/executions/${executionId}/variables/${key}`,
      {
        headers: {
          Authorization: `Bearer ${this.getExecutionToken(executionId)}`,
        },
      },
    );

    return response.json();
  }

  async setVariable(executionId: string, key: string, value: any) {
    await fetch(`${this.baseUrl}/executions/${executionId}/variables/${key}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.getExecutionToken(executionId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value }),
    });
  }

  async getInput(executionId: string) {
    const response = await fetch(
      `${this.baseUrl}/executions/${executionId}/input`,
      {
        headers: {
          Authorization: `Bearer ${this.getExecutionToken(executionId)}`,
        },
      },
    );

    return response.json();
  }

  async setOutput(executionId: string, data: any) {
    await fetch(`${this.baseUrl}/executions/${executionId}/output`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.getExecutionToken(executionId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }
}
```

## Frontend Changes Required

### 1. Execution Status Components

#### Update ExecutionLogsViewer

**File:** `src/components/executions/ExecutionLogsViewer.tsx`

```typescript
// Add real-time log streaming
export function ExecutionLogsViewer({ executionId }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<JobStatus>('pending');

  useEffect(() => {
    // Connect to WebSocket for real-time logs
    const socket = io('/logs');

    socket.emit('subscribe', executionId);

    socket.on('log', (logEntry) => {
      setLogs(prev => [...prev, logEntry]);
    });

    socket.on('status', (newStatus) => {
      setStatus(newStatus);
    });

    return () => {
      socket.emit('unsubscribe', executionId);
      socket.disconnect();
    };
  }, [executionId]);

  return (
    <div className="space-y-4">
      <StatusIndicator status={status} />
      <LogStream logs={logs} />
    </div>
  );
}
```

#### Create Job Status Component

**New file:** `src/components/jobs/JobStatusCard.tsx`

```typescript
export function JobStatusCard({ job }: { job: Job }) {
  const statusColors = {
    pending: 'text-gray-500',
    acknowledged: 'text-blue-500',
    running: 'text-yellow-500',
    completed: 'text-green-500',
    failed: 'text-red-500'
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job {job.id}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Status:</span>
            <span className={statusColors[job.status]}>{job.status}</span>
          </div>
          <div className="flex justify-between">
            <span>Created:</span>
            <span>{formatDate(job.createdAt)}</span>
          </div>
          {job.orchestratorId && (
            <div className="flex justify-between">
              <span>Orchestrator:</span>
              <span>{job.orchestratorId}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

### 2. Event Execution UI Updates

#### Update Event Execute Button

**File:** `src/components/events/EventActions.tsx`

```typescript
// Show job creation instead of direct execution
export function ExecuteButton({ event }: { event: Event }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const executeMutation = api.events.execute.useMutation();

  const handleExecute = async () => {
    const result = await executeMutation.mutateAsync({
      eventId: event.id
    });

    setJobId(result.jobId);

    // Redirect to job status page
    router.push(`/jobs/${result.jobId}`);
  };

  return (
    <>
      <Button onClick={handleExecute} disabled={executeMutation.isLoading}>
        {executeMutation.isLoading ? 'Creating Job...' : 'Execute'}
      </Button>
      {jobId && <JobStatusBadge jobId={jobId} />}
    </>
  );
}
```

### 3. Dashboard Updates

#### Add Jobs Overview Widget

**Update:** `src/components/dashboard/DashboardStats.tsx`

```typescript
export function DashboardStats() {
  const { data: stats } = api.jobs.getStats.useQuery();

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatsCard
        title="Pending Jobs"
        value={stats?.pending || 0}
        icon={<Clock />}
        trend={stats?.pendingTrend}
      />
      <StatsCard
        title="Running Jobs"
        value={stats?.running || 0}
        icon={<Play />}
        trend={stats?.runningTrend}
      />
      <StatsCard
        title="Completed Today"
        value={stats?.completedToday || 0}
        icon={<CheckCircle />}
        trend={stats?.completedTrend}
      />
      <StatsCard
        title="Failed Today"
        value={stats?.failedToday || 0}
        icon={<XCircle />}
        trend={stats?.failedTrend}
      />
    </div>
  );
}
```

### 4. New Pages Required

#### Jobs List Page

**New file:** `src/app/(dashboard)/jobs/page.tsx`

```typescript
export default function JobsPage() {
  const { data: jobs, isLoading } = api.jobs.list.useQuery();

  return (
    <DashboardLayout>
      <PageHeader
        title="Jobs"
        description="View and manage execution jobs"
      />

      <div className="space-y-4">
        <JobFilters />
        <JobsTable jobs={jobs} />
      </div>
    </DashboardLayout>
  );
}
```

#### Job Details Page

**New file:** `src/app/(dashboard)/jobs/[id]/page.tsx`

```typescript
export default function JobDetailsPage({ params }: { params: { id: string } }) {
  const { data: job } = api.jobs.get.useQuery({ id: params.id });

  return (
    <DashboardLayout>
      <PageHeader
        title={`Job ${params.id}`}
        description="Job execution details"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ExecutionLogsViewer executionId={params.id} />
        </div>
        <div>
          <JobStatusCard job={job} />
          <JobMetadata job={job} />
        </div>
      </div>
    </DashboardLayout>
  );
}
```

## Code Removal Plan

### 1. Services to Remove

- `src/lib/scheduler/local-executor.ts` - Direct execution
- `src/lib/scheduler/execute-script.ts` - Old execution logic
- `src/runtime-helpers/*` - File-based helpers

### 2. API Routes to Remove

- Direct execution logic in `/api/cron/route.ts`
- Synchronous execution in tRPC routers

### 3. Dependencies to Remove

- `child_process` usage for script execution
- File system operations for runtime helpers
- Temporary directory management

## Migration Strategy

### Phase 1: Parallel Implementation (Week 1)

1. Add job management system alongside existing execution
2. Create orchestrator integration endpoints
3. Implement WebSocket log streaming
4. Add feature flag for gradual rollout

### Phase 2: Frontend Updates (Week 2)

1. Update execution UI to show job status
2. Add real-time log streaming components
3. Create job management pages
4. Update dashboard with job statistics

### Phase 3: Backend Migration (Week 3)

1. Route new executions through orchestrator
2. Migrate existing executions to job model
3. Update scheduler to create jobs
4. Remove direct execution code

### Phase 4: Cleanup (Week 4)

1. Remove all deprecated code
2. Update documentation
3. Performance optimization
4. Security audit

## Configuration Updates

### Environment Variables

```env
# Add orchestrator configuration
ORCHESTRATOR_URL=http://orchestrator:8080
ORCHESTRATOR_TOKEN=secret-token
RUNTIME_API_URL=http://runtime:8081

# Remove old variables
# RUNTIME_HELPERS_PATH (no longer needed)
```

### Docker Compose Updates

```yaml
services:
  app:
    depends_on:
      - orchestrator
      - runtime
    environment:
      - ORCHESTRATOR_URL=http://orchestrator:8080

  orchestrator:
    image: cronium/orchestrator:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

  runtime:
    image: cronium/runtime:latest
    ports:
      - "8081:8081"
```

## Testing Requirements

### 1. Unit Tests

- Job service CRUD operations
- API endpoint authentication
- WebSocket message handling
- Status update logic

### 2. Integration Tests

- End-to-end job execution
- Real-time log streaming
- Multi-server execution
- Workflow execution with variables

### 3. Migration Tests

- Existing event compatibility
- Data migration scripts
- Rollback procedures
- Performance benchmarks

## Security Improvements

### Before Migration

- Scripts run with host system access
- No resource limits
- Shared execution environment
- File-based data passing

### After Migration

- Isolated container execution
- Resource limits enforced
- Network segmentation
- API-based secure communication

## Performance Considerations

### Improvements

1. **Parallel Execution**: Multiple orchestrators can process jobs
2. **Resource Management**: Controlled CPU/memory usage
3. **Connection Pooling**: Efficient SSH connections
4. **Real-time Updates**: WebSocket instead of polling

### Potential Issues

1. **Container Startup**: ~1-2 second overhead
2. **API Latency**: Additional network calls
3. **Storage**: Container images and volumes

## Rollback Plan

1. **Feature Flag**: Control execution path
2. **Dual Mode**: Support both execution methods temporarily
3. **Data Preservation**: Keep execution logs in both formats
4. **Quick Revert**: Single config change to rollback

## Success Metrics

1. **Security**: Zero host execution vulnerabilities
2. **Performance**: < 2s container startup time
3. **Reliability**: 99.9% job completion rate
4. **Scalability**: Support 100+ concurrent jobs
5. **User Experience**: Real-time log streaming

## Conclusion

This migration represents a fundamental improvement in Cronium's architecture, addressing critical security vulnerabilities while adding scalability and reliability. The phased approach ensures minimal disruption while allowing for thorough testing and validation at each step.
