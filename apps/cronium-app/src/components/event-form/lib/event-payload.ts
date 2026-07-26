import { EventType, RunLocation } from "@/shared/schema";
import type { EventFormData } from "./event-form-schema";

/** Script event types (have editable content, run via the orchestrator). */
export const SCRIPT_EVENT_TYPES: readonly EventType[] = [
  EventType.PYTHON,
  EventType.BASH,
  EventType.NODEJS,
];

export function isScriptEventType(type: EventType): boolean {
  return SCRIPT_EVENT_TYPES.includes(type);
}

/**
 * Derive the run location from the selected execution locations: local only,
 * servers only, or both. With no servers selected the event is local-only
 * regardless of the local checkbox (the form's location refinement prevents
 * submitting with neither selected).
 */
export function deriveRunLocation(
  runOnLocal: boolean,
  selectedServerIds: number[],
): RunLocation {
  return selectedServerIds.length === 0
    ? RunLocation.LOCAL
    : runOnLocal
      ? RunLocation.LOCAL_AND_REMOTE
      : RunLocation.REMOTE;
}

/**
 * Build the create/update event payload from validated form values.
 * Pure: no React/tRPC imports.
 *
 * Behavior (mirrors the server's createEventSchema expectations):
 * - Form-only fields (`useCronScheduling`, `runOnLocal`, form-shaped
 *   `httpHeaders`) are stripped from the payload.
 * - Interval mode omits `customSchedule`; cron mode passes it through and
 *   leaves `scheduleNumber`/`scheduleUnit` untouched.
 * - `content` is only sent for script events.
 * - `startTime` (a `datetime-local` string) becomes an ISO timestamp or null.
 * - `toolActionConfig` is JSON-stringified for tool-action events only.
 * - `httpHeaders` is only included for HTTP request events.
 */
export function buildEventPayload(data: EventFormData) {
  const isScriptType = isScriptEventType(data.type);
  const isHttpRequest = data.type === EventType.HTTP_REQUEST;
  const isToolAction = data.type === EventType.TOOL_ACTION;

  // Remove form-only fields and prepare for API
  const {
    useCronScheduling: _useCronScheduling,
    httpHeaders: _httpHeaders,
    runOnLocal,
    ...baseData
  } = data;

  return {
    ...baseData,
    runLocation: deriveRunLocation(runOnLocal, data.selectedServerIds),
    content: isScriptType ? data.content : undefined,
    startTime: data.startTime ? new Date(data.startTime).toISOString() : null,
    customSchedule: data.useCronScheduling ? data.customSchedule : undefined,
    timezone: data.timezone,
    catchupPolicy: data.catchupPolicy,
    overlapPolicy: data.overlapPolicy,
    priority: data.priority,
    serverId: null, // Deprecated, using selectedServerIds
    toolActionConfig:
      isToolAction && data.toolActionConfig
        ? JSON.stringify(data.toolActionConfig)
        : undefined,
    envVars: data.envVars, // Already an array
    tags: data.tags, // Already an array
    // Include httpHeaders as array if it's HTTP request
    ...(isHttpRequest &&
      data.httpHeaders && {
        httpHeaders: data.httpHeaders, // Already an array
      }),
  };
}

export type EventPayload = ReturnType<typeof buildEventPayload>;
