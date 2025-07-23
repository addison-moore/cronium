import type { EventWithRelations } from "@/server/storage";
import { JobType, EventType, RunLocation } from "@/shared/schema";
import type { ScriptType } from "@/shared/schema";

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

    case JobType.TOOL_ACTION:
      if (event.toolActionConfig) {
        const config = event.toolActionConfig as Record<string, unknown>;
        jobPayload.toolAction = {
          toolType: (config.toolType as string) || "unknown",
          config: config,
        };
      }
      break;
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

  // Add target information
  if (event.runLocation === RunLocation.REMOTE && event.serverId) {
    jobPayload.target = {
      serverId: event.serverId,
    };
  } else {
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

  // Add retry configuration
  if (event.retries) {
    jobPayload.retries = event.retries;
  }

  return jobPayload;
}
