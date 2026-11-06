import type { EventWithRelations } from "@/server/storage";
import { JobType, EventType, RunLocation } from "@/shared/schema";
import type { ScriptType } from "@/shared/schema";
import { parseToolActionConfig } from "@/lib/tools/tool-action-config";
import {
  NO_SERVERS_MESSAGE,
  canRunWithoutServers,
} from "@/shared/event-servers";

export interface JobPayload {
  executionLogId: number;
  input: Record<string, unknown>;
  script?: {
    type: ScriptType;
    content: string;
  };
  httpRequest?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  toolAction?: {
    toolType: string;
    config: Record<string, unknown>;
  };
  environment?: Record<string, string>;
  target?: {
    serverId?: number;
    containerImage?: string;
    // LOCAL_AND_REMOTE events: also run a local container branch alongside
    // the remote servers (consumed by the enhanced job transformer)
    runOnLocal?: boolean;
  };
  timeout?: {
    value: number;
    unit: string;
  };
  retries?: number;
}

export function buildJobPayload(
  event: EventWithRelations,
  logId: number,
  inputData?: Record<string, unknown>,
): JobPayload {
  const jobPayload: JobPayload = {
    executionLogId: logId,
    input: inputData ?? {},
  };

  // Determine job type
  let jobType: JobType;
  if (event.type === EventType.HTTP_REQUEST) {
    jobType = JobType.HTTP_REQUEST;
  } else if (event.toolActionConfig) {
    jobType = JobType.TOOL_ACTION;
  } else {
    jobType = JobType.SCRIPT;
  }

  // Add type-specific details
  switch (jobType) {
    case JobType.SCRIPT:
      jobPayload.script = {
        type: event.type as ScriptType,
        content: event.content ?? "",
      };
      break;

    case JobType.HTTP_REQUEST:
      if (event.httpMethod && event.httpUrl) {
        interface HttpRequest {
          method: string;
          url: string;
          headers?: Record<string, string>;
          body?: string;
        }
        const httpRequest: HttpRequest = {
          method: event.httpMethod,
          url: event.httpUrl,
        };
        if (event.httpHeaders) {
          httpRequest.headers = event.httpHeaders as Record<string, string>;
        }
        if (event.httpBody) {
          httpRequest.body = event.httpBody;
        }
        jobPayload.httpRequest = httpRequest;
      }
      break;

    case JobType.TOOL_ACTION: {
      // Parse defensively: toolActionConfig may be an object or a (double-)
      // encoded JSON string depending on when the event was saved.
      const config = parseToolActionConfig(event.toolActionConfig);
      if (config) {
        jobPayload.toolAction = {
          toolType: config.toolType ?? "unknown",
          config,
        };
      }
      break;
    }
  }

  // Add environment variables
  if (event.envVars && Array.isArray(event.envVars)) {
    jobPayload.environment = {};
    event.envVars.forEach((envVar) => {
      if (envVar.key && envVar.value && jobPayload.environment) {
        jobPayload.environment[envVar.key] = envVar.value;
      }
    });
  }

  // Add target information. REMOTE and LOCAL_AND_REMOTE both target a server;
  // LOCAL_AND_REMOTE additionally sets runOnLocal so the enhanced transformer
  // adds a local container branch to the fan-out.
  const runsOnServers = event.runLocation !== RunLocation.LOCAL;
  const runOnLocal = event.runLocation === RunLocation.LOCAL_AND_REMOTE;
  // Check for direct serverId first, then the servers table. For now, use the
  // first server (multi-server support will be added later)
  const serverId = event.serverId ?? event.servers?.[0]?.id;
  if (runsOnServers && serverId) {
    jobPayload.target = {
      serverId,
      ...(runOnLocal && { runOnLocal: true }),
    };
  } else if (!canRunWithoutServers(event)) {
    // dispatchEventJob refuses this before it gets here. Never fall back to a
    // container: that runs a script written for a server on the Cronium host.
    throw new Error(`Event ${event.id}: ${NO_SERVERS_MESSAGE}`);
  } else {
    // Local execution - use container. That includes the local half of a
    // LOCAL_AND_REMOTE event whose servers are gone. HTTP requests and tool
    // actions run in the worker, which doesn't read this target.
    jobPayload.target = {
      containerImage:
        jobType === JobType.SCRIPT
          ? `cronium/${event.type.toLowerCase()}:latest`
          : jobType === JobType.HTTP_REQUEST
            ? "cronium/http-client:latest"
            : "cronium/tool-executor:latest",
    };
  }

  // Add timeout configuration
  if (event.timeoutValue && event.timeoutUnit) {
    jobPayload.timeout = {
      value: event.timeoutValue,
      unit: event.timeoutUnit,
    };
  }

  // Add retry configuration. In-process job types (tool actions, HTTP requests)
  // run a single attempt in the app and must never be re-queued on failure, or a
  // FAILED status would flip the job back to QUEUED with nothing to run it.
  const runsInProcess =
    jobType === JobType.TOOL_ACTION || jobType === JobType.HTTP_REQUEST;
  if (event.retries && !runsInProcess) {
    jobPayload.retries = event.retries;
  }

  return jobPayload;
}
