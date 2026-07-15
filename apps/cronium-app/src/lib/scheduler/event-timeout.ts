import type { Event } from "@/shared/schema";

const UNIT_MS: Record<string, number> = {
  SECONDS: 1000,
  MINUTES: 60_000,
  HOURS: 3_600_000,
  DAYS: 86_400_000,
};

/**
 * Resolve an event's configured execution timeout (the "Timeout" field in the
 * event settings: `timeoutValue` + `timeoutUnit`) to milliseconds. Defaults to
 * 30s when unset. Mirrors the conversion the scheduler uses for job polling, so
 * in-process tool/HTTP execution honors the same setting.
 */
export function eventTimeoutMs(
  event: Pick<Event, "timeoutValue" | "timeoutUnit">,
): number {
  const value = event.timeoutValue ?? 30;
  const unit = (event.timeoutUnit as string | null)?.toUpperCase() ?? "SECONDS";
  return value * (UNIT_MS[unit] ?? 1000);
}
