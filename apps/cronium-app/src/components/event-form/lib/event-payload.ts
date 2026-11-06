import superjson from "superjson";
import { EventType, RunLocation } from "@/shared/schema";
import { toDatetimeLocal } from "./event-form-defaults";
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
 * The instant to save for the start time field. A field still showing the stored time
 * keeps that exact instant, because its string can't carry all of it: it has no seconds,
 * and in the hour the clocks repeat it can only be read as the first of the two. Anything
 * else was typed, and means the browser's local time.
 */
function startTimeToSave(
  value: EventFormData["startTime"],
  storedStartTime: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  if (storedStartTime && value === toDatetimeLocal(storedStartTime)) {
    return new Date(storedStartTime).toISOString();
  }
  return new Date(value).toISOString();
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
 * - `startTime` (a `datetime-local` string) becomes an ISO timestamp or null. While
 *   the field still shows `storedStartTime`, what the event holds now, that goes back
 *   unchanged.
 * - `toolActionConfig` is JSON-stringified for tool-action events only.
 * - `httpHeaders` is only included for HTTP request events.
 */
export function buildEventPayload(
  data: EventFormData,
  storedStartTime?: Date | string | null,
) {
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
    startTime: startTimeToSave(data.startTime, storedStartTime),
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

/**
 * How many bytes saving `input` sends, measured the way lib/trpc.ts's batch link writes
 * the request: one call at index 0, through superjson, as JSON. Escaping is why this can
 * be far more than the script's own length.
 */
export function saveRequestBytes(input: unknown): number {
  return new Blob([JSON.stringify({ 0: superjson.serialize(input) })]).size;
}

/** Why a save of `bytes` can't go ahead, in terms of what the person is editing. */
export function tooLongToSaveMessage(type: EventType, bytes: number): string {
  // Rounded up, so one byte over never reads as exactly the limit.
  const size = (Math.ceil((bytes / (1024 * 1024)) * 100) / 100).toFixed(2);
  return isScriptEventType(type)
    ? `This script is too long to save. With the rest of the event it comes to ${size} MB once sent, and the limit is 10 MB. Each line break or quote counts as 2 bytes.`
    : `This event is too long to save. It comes to ${size} MB once sent, and the limit is 10 MB.`;
}
