import type { Job } from "@/shared/schema";
import { JobType, JobPriority } from "@/shared/schema";

/**
 * Transform a job from the database format to the format expected by the orchestrator
 */
export interface OrchestratorJob {
  id: string;
  type: string;
  priority: number;
  createdAt: Date | null;
  scheduledFor: Date | null;
  attempts: number;
  execution: {
    environment: Record<string, string>;
    timeout: number;
    inputData: Record<string, unknown>;
    variables: Record<string, unknown>;
    target: {
      type: string;
      serverId?: string;
      serverDetails?: {
        id: string;
        name: string;
        host: string;
        port: number;
        username: string;
        privateKey: string;
        passphrase?: string;
      };
    };
    script?: {
      type: string;
      content: string;
      workingDirectory: string;
    };
    http?: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: string;
    };
    resources?: {
      cpuLimit: number;
      memoryLimit: number;
      diskLimit: number;
      pidsLimit: number;
    };
    retryPolicy?: {
      maxAttempts: number;
      backoffType: string;
      backoffDelay: number;
    };
  };
  metadata: Record<string, unknown>;
}

interface JobPayload {
  environment?: Record<string, string>;
  timeout?: { value: number };
  input?: Record<string, unknown>;
  target?: { serverId?: number };
  script?: {
    type: string;
    content: string;
    workingDirectory?: string;
  };
  httpRequest?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  resources?: {
    cpuLimit?: number;
    memoryLimit?: number;
    diskLimit?: number;
    pidsLimit?: number;
  };
  retries?: number;
}

export function transformJobForOrchestrator(job: Job): OrchestratorJob {
  const payload = job.payload as JobPayload;

  // Build execution config from payload
  const execution: OrchestratorJob["execution"] = {
    environment: payload.environment ?? {},
    timeout: payload.timeout?.value ?? 3600, // Default 1 hour in seconds
    inputData: payload.input ?? {},
    variables: {},
    target: { type: "local" }, // Initialize with default
  };

  // Set target based on payload
  if (payload.target?.serverId) {
    execution.target = {
      type: "server",
      serverId: String(payload.target.serverId),
    };
  } else {
    execution.target = {
      type: "local",
    };
  }

  // Set script configuration if present
  if (payload.script) {
    execution.script = {
      type: payload.script.type.toLowerCase(), // Convert BASH -> bash, PYTHON -> python, etc.
      content: payload.script.content,
      workingDirectory: payload.script.workingDirectory ?? "",
    };
  }

  // Set HTTP configuration if present
  if (payload.httpRequest) {
    interface HttpConfig {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: string;
    }
    const http: HttpConfig = {
      method: payload.httpRequest.method,
      url: payload.httpRequest.url,
      headers: payload.httpRequest.headers ?? {},
    };
    if (payload.httpRequest.body !== undefined) {
      http.body = payload.httpRequest.body;
    }
    execution.http = http;
  }

  // Set resources if specified
  if (payload.resources) {
    execution.resources = {
      cpuLimit: payload.resources.cpuLimit ?? 0.5,
      memoryLimit: payload.resources.memoryLimit ?? 536870912, // 512MB in bytes
      diskLimit: payload.resources.diskLimit ?? 1073741824, // 1GB in bytes
      pidsLimit: payload.resources.pidsLimit ?? 100,
    };
  }

  // Set retry policy if specified
  if (payload.retries && payload.retries > 0) {
    execution.retryPolicy = {
      maxAttempts: payload.retries,
      backoffType: "exponential",
      backoffDelay: 5, // 5 seconds
    };
  }

  // Map job type - convert SCRIPT to container, keep others
  let orchestratorJobType: string = job.type;
  if (job.type === JobType.SCRIPT) {
    // Determine execution type based on target
    orchestratorJobType = payload.target?.serverId ? "ssh" : "container";
  } else if (job.type === JobType.HTTP_REQUEST) {
    orchestratorJobType = "container"; // HTTP requests run in containers
  } else if (job.type === JobType.TOOL_ACTION) {
    orchestratorJobType = "container"; // Tool actions run in containers
  }

  // Build the transformed job
  return {
    id: job.id,
    type: orchestratorJobType,
    priority:
      job.priority === JobPriority.HIGH
        ? 10
        : job.priority === JobPriority.LOW
          ? 1
          : 5,
    createdAt: job.createdAt,
    scheduledFor: job.scheduledFor,
    attempts: job.attempts || 0,
    execution,
    metadata: {
      ...(job.metadata as Record<string, unknown>),
      originalType: job.type,
      eventId: job.eventId,
      userId: job.userId,
    },
  };
}

/**
 * Transform multiple jobs for the orchestrator
 */
export function transformJobsForOrchestrator(jobs: Job[]): OrchestratorJob[] {
  return jobs.map(transformJobForOrchestrator);
}
