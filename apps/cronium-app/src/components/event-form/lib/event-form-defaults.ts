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
import { normalizeTimeUnit } from "@/lib/scheduling/schedule-math";
import type { EventFormData } from "./event-form-schema";

/** A server as an event's relations carry it. */
export interface EventFormServer {
  id: number;
  name: string;
  address: string;
  isArchived?: boolean;
}

// Extended Event type that includes relation properties
export interface EventFormInitialData extends Partial<Event> {
  // What events.getById returns, so its result can be passed straight in. The
  // form has to find these: it saves whatever rows it shows, and events.update
  // takes `envVars: []` as deleting every variable the event has.
  envVars?: Array<{ key: string; value: string }>;
  // The same rows, as the event details page's view model names them.
  environmentVariables?: Array<{ key: string; value: string }>;
  servers?: EventFormServer[];
  server?: EventFormServer | null;
}

/** The run location counterpart of `normalizeTimeUnit`. */
function normalizeRunLocation(location: unknown): RunLocation | null {
  if (typeof location !== "string") return null;
  const normalized = location.trim().toUpperCase() as RunLocation;
  return Object.values(RunLocation).includes(normalized) ? normalized : null;
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
 * - `scheduleUnit`, `timeoutUnit` and `runLocation` are normalized, because
 *   rows from before the enum migration hold lowercase values. The form's
 *   schema refuses those with no message, so the save would silently do nothing.
 */
export function buildEventFormDefaults(
  initialData?: EventFormInitialData,
): EventFormData {
  const runLocation =
    normalizeRunLocation(initialData?.runLocation) ?? RunLocation.LOCAL;

  return {
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    shared: initialData?.shared ?? false,
    type: initialData?.type ?? EventType.PYTHON,
    content: initialData?.content ?? getDefaultScriptContent(EventType.PYTHON),
    status: initialData?.status ?? EventStatus.DRAFT,
    triggerType: initialData?.triggerType ?? EventTriggerType.MANUAL,
    scheduleNumber: initialData?.scheduleNumber ?? 5,
    scheduleUnit:
      normalizeTimeUnit(initialData?.scheduleUnit) ?? TimeUnit.MINUTES,
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
    timeoutUnit:
      normalizeTimeUnit(initialData?.timeoutUnit) ?? TimeUnit.SECONDS,
    runLocation,
    // Local unless the event is remote-only
    runOnLocal: runLocation !== RunLocation.REMOTE,
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
    // A row from the API also has an id, an event id and timestamps.
    return (value as Array<{ key: string; value: string }>).map((envVar) => ({
      key: envVar.key,
      value: envVar.value,
    }));
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
 * The servers the form must keep selected and on screen for an event: its links,
 * and an archived direct server (the deprecated `serverId`), which stops the
 * event just as an archived link does. A LOCAL event's direct server is left out:
 * ticked, the event would start running on it once it was restored and saved.
 * Left out, any save clears it.
 */
export function linkedServers(
  initialData?: EventFormInitialData,
): EventFormServer[] {
  const links = initialData?.servers ?? [];
  const direct = initialData?.server;
  const runLocation = initialData?.runLocation ?? RunLocation.LOCAL;
  return direct?.isArchived &&
    runLocation !== RunLocation.LOCAL &&
    !links.some((link) => link.id === direct.id)
    ? [...links, direct]
    : links;
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
