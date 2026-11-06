import { EventStatus, RunLocation } from "@/shared/schema";
import type { TimeUnit } from "@/shared/schema";
import type { Event } from "./types";

/**
 * The events.create input for a draft copy of an event in a list.
 *
 * The copy keeps its server links, so an archived one makes events.create refuse,
 * in line with events.fork. Leaving it out instead could make a REMOTE draft with
 * no servers, which activates and then runs in a local container, so the copy
 * would quietly move the script.
 *
 * It only holds what the lists hold, so environment variables and the trigger
 * and scheduling policies aren't copied.
 */
export function buildDuplicateEventInput(event: Event) {
  return {
    // Required fields
    name: `${event.name} (copy)`,
    type: event.type,

    // Optional fields
    ...(event.description !== undefined &&
      event.description !== null && {
        description: event.description,
      }),
    ...(event.shared !== undefined && {
      shared: Boolean(event.shared),
    }),
    ...(Array.isArray(event.tags) && {
      tags: event.tags.map(String),
    }),
    ...(event.content !== undefined &&
      event.content !== null && {
        content: event.content,
      }),
    status: EventStatus.DRAFT,

    // HTTP specific fields
    ...(event.httpMethod !== undefined &&
      event.httpMethod !== null && {
        httpMethod: event.httpMethod,
      }),
    ...(event.httpUrl !== undefined &&
      event.httpUrl !== null && {
        httpUrl: event.httpUrl,
      }),
    ...(Array.isArray(event.httpHeaders) && {
      httpHeaders: event.httpHeaders.map(
        (h: { key?: unknown; value?: unknown }) => ({
          key:
            typeof h.key === "string"
              ? h.key
              : typeof h.key === "number" || typeof h.key === "boolean"
                ? String(h.key)
                : "",
          value:
            typeof h.value === "string"
              ? h.value
              : typeof h.value === "number" || typeof h.value === "boolean"
                ? String(h.value)
                : "",
        }),
      ),
    }),
    ...(event.httpBody !== undefined &&
      event.httpBody !== null && {
        httpBody: event.httpBody,
      }),

    // Tool action config: the schema takes a string, and the column can hold
    // either an object or an already encoded string
    ...(event.toolActionConfig !== undefined &&
      event.toolActionConfig !== null && {
        toolActionConfig:
          typeof event.toolActionConfig === "string"
            ? event.toolActionConfig
            : JSON.stringify(event.toolActionConfig),
      }),

    // Schedule related fields
    ...(typeof event.scheduleNumber === "number" && {
      scheduleNumber: event.scheduleNumber,
    }),
    ...(event.scheduleUnit && {
      scheduleUnit: event.scheduleUnit as TimeUnit,
    }),
    ...(event.customSchedule !== undefined &&
      event.customSchedule !== null && {
        customSchedule: event.customSchedule,
      }),

    // Server related fields
    ...(event.runLocation && {
      runLocation: event.runLocation as RunLocation,
    }),
    ...(typeof event.serverId === "number" && {
      serverId: event.serverId,
    }),
    // Not for a LOCAL event: events.create wouldn't link them, but would still
    // check them, so a stale link could refuse a copy that doesn't use it.
    ...(event.runLocation !== RunLocation.LOCAL &&
      Array.isArray(event.eventServers) && {
        selectedServerIds: event.eventServers,
      }),

    // Additional fields
    ...(typeof event.timeoutValue === "number" && {
      timeoutValue: event.timeoutValue,
    }),
    ...(event.timeoutUnit && {
      timeoutUnit: event.timeoutUnit as TimeUnit,
    }),
    ...(typeof event.retries === "number" && {
      retries: event.retries,
    }),
  };
}
