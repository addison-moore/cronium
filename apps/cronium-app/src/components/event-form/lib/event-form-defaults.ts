import { format } from "date-fns";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  CatchupPolicy,
  OverlapPolicy,
  type Event,
} from "@/shared/schema";
import { getDefaultScriptContent } from "@/lib/scriptTemplates";
import type { EventFormData } from "./event-form-schema";

// Extended Event type that includes relation properties
export interface EventFormInitialData extends Partial<Event> {
  environmentVariables?: Array<{ key: string; value: string }>;
  servers?: Array<{ id: number; name: string }>;
}

/**
 * A stored start time as a `datetime-local` input's value: the browser's local time, to
 * the minute. The input has no zone of its own and `buildEventPayload` reads what it
 * holds as local time, so writing anything else here moves the time on every save.
 */
export function toDatetimeLocal(startTime: Date | string): string {
  return format(new Date(startTime), "yyyy-MM-dd'T'HH:mm");
}

/**
 * Resolve the form's default values from an (optional) existing event.
 * Pure: no React/tRPC imports.
 *
 * - `useCronScheduling` is derived from the presence of a custom cron
 *   expression (cron mode vs interval mode).
 * - `runOnLocal` is true unless the event is remote-only.
 * - `startTime` is converted to the `datetime-local` input format
 *   (`YYYY-MM-DDTHH:mm`, the browser's local time).
 */
export function buildEventFormDefaults(
  initialData?: EventFormInitialData,
): EventFormData {
  return {
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    shared: initialData?.shared ?? false,
    type: initialData?.type ?? EventType.PYTHON,
    content: initialData?.content ?? getDefaultScriptContent(EventType.PYTHON),
    status: initialData?.status ?? EventStatus.DRAFT,
    triggerType: initialData?.triggerType ?? EventTriggerType.MANUAL,
    scheduleNumber: initialData?.scheduleNumber ?? 5,
    scheduleUnit: initialData?.scheduleUnit ?? TimeUnit.MINUTES,
    startTime: initialData?.startTime
      ? toDatetimeLocal(initialData.startTime)
      : null,
    useCronScheduling: !!initialData?.customSchedule,
    customSchedule: initialData?.customSchedule ?? "",
    timezone: initialData?.timezone ?? "UTC",
    catchupPolicy: initialData?.catchupPolicy ?? CatchupPolicy.SKIP,
    overlapPolicy: initialData?.overlapPolicy ?? OverlapPolicy.ALLOW,
    priority: initialData?.priority ?? 1,
    timeoutValue: initialData?.timeoutValue ?? 30,
    timeoutUnit: initialData?.timeoutUnit ?? TimeUnit.SECONDS,
    runLocation: initialData?.runLocation ?? RunLocation.LOCAL,
    // Local unless the event is remote-only
    runOnLocal: initialData?.runLocation !== RunLocation.REMOTE,
    selectedServerIds: [],
    retries: initialData?.retries ?? 0,
    maxExecutions: initialData?.maxExecutions ?? 0,
    resetCounterOnActive: initialData?.resetCounterOnActive ?? false,
    envVars: [],
    tags: [],
    toolActionConfig: null,
  };
}

/**
 * Parse a stored tags value (JSON string or array) into a string array.
 * Returns null when there is nothing to set (missing/unrecognized value);
 * returns [] for a malformed JSON string (mirrors the form's historical
 * behavior of resetting to empty on parse failure).
 */
export function parseInitialTags(tags: unknown): string[] | null {
  if (!tags) return null;
  if (typeof tags === "string") {
    try {
      return JSON.parse(tags) as string[];
    } catch {
      return [];
    }
  }
  if (Array.isArray(tags)) {
    return tags as string[];
  }
  return null;
}

/**
 * Parse stored environment variables (JSON string or array) into key/value
 * pairs. Same null/[] semantics as parseInitialTags.
 */
export function parseInitialEnvVars(
  value: unknown,
): Array<{ key: string; value: string }> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Array<{ key: string; value: string }>;
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value as Array<{ key: string; value: string }>;
  }
  return null;
}

/** Extract the numeric server ids from an event's servers relation. */
export function extractServerIds(
  servers: Array<{ id: number; name: string }>,
): number[] {
  return servers
    .map((server) => server.id)
    .filter((id): id is number => typeof id === "number");
}

/**
 * Timezone options for the schedule section: a curated shortlist (with the
 * viewer's own timezone) first, then every zone the runtime knows about,
 * de-duplicated in order.
 */
export function buildTimezoneOptions(): string[] {
  const curated = [
    "UTC",
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Kolkata",
    "Australia/Sydney",
  ];
  const all =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : curated;
  return [...new Set([...curated, ...all])];
}
