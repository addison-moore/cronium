/**
 * Schedule math for the durable dispatcher (_plans/scheduling/PLAN.md §3.1).
 *
 * Pure functions of (spec, clock) — no database, no ambient time. Callers pass
 * the clock in; the dispatcher passes the DB clock. Unit-tested with fixed
 * dates, including DST transitions.
 *
 * Semantics:
 * - INTERVAL means true elapsed time: `next = max(from, prevNext + interval)`.
 *   No slot arrays, so "every 7 minutes" never glitches at hour boundaries and
 *   "every 3 days" is exactly 72h across month boundaries.
 * - CRON is evaluated in the schedule's IANA timezone via cron-parser, which
 *   shifts ticks that land in a DST gap to the next valid instant and fires
 *   once (not twice) in a DST overlap.
 */

import { CronExpressionParser } from "cron-parser";
import { ScheduleKind, TimeUnit } from "@/shared/schema";
import type { Event, Workflow } from "@/shared/schema";

/** Sub-10s intervals are not supported (PLAN.md §3.1): dispatch precision is
 * ± one dispatcher tick, and we refuse to pretend otherwise. */
export const MIN_INTERVAL_SECONDS = 10;

/** RUN_ALL catch-up never replays more than this many ticks; the overflow is
 * recorded as a CATCHUP_OVERFLOW incident (PLAN.md §4.1). */
export const CATCHUP_RUN_ALL_CAP = 25;

const UNIT_SECONDS: Record<TimeUnit, number> = {
  [TimeUnit.SECONDS]: 1,
  [TimeUnit.MINUTES]: 60,
  [TimeUnit.HOURS]: 3_600,
  [TimeUnit.DAYS]: 86_400,
};

const TIME_UNIT_VALUES = new Set<string>(Object.values(TimeUnit));

export interface ScheduleSpec {
  kind: ScheduleKind;
  /** Required when kind = INTERVAL. */
  intervalSeconds?: number;
  /** Required when kind = CRON. */
  cronExpr?: string;
  /** IANA zone name; only meaningful for CRON. */
  timezone: string;
  /** Optional window floor: no tick fires before this instant. */
  startAt?: Date | null;
}

/** Database rows predating the enum migration store lowercase units. Runtime
 * normalization is required because Drizzle's enum type is compile-time only. */
export function normalizeTimeUnit(unit: unknown): TimeUnit | null {
  if (typeof unit !== "string") return null;
  const normalized = unit.trim().toUpperCase();
  return TIME_UNIT_VALUES.has(normalized) ? (normalized as TimeUnit) : null;
}

export function intervalSecondsFor(n: number, unit: unknown): number {
  const normalized = normalizeTimeUnit(unit);
  if (!normalized || !Number.isFinite(n)) return Number.NaN;
  return n * UNIT_SECONDS[normalized];
}

/** Validation error (not a clamp): the schedule form and dispatcher both
 * reject intervals below the floor rather than silently adjusting them. */
export function validateIntervalSeconds(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Interval must be a positive number";
  }
  if (seconds < MIN_INTERVAL_SECONDS) {
    return `Intervals below ${MIN_INTERVAL_SECONDS}s are not supported`;
  }
  return null;
}

export interface CronValidation {
  valid: boolean;
  error?: string;
  /** Next few fire instants (UTC) for schedule preview. */
  next?: Date[];
}

export function validateCronExpr(
  expr: string,
  timezone = "UTC",
  previewCount = 5,
): CronValidation {
  try {
    const interval = CronExpressionParser.parse(expr, { tz: timezone });
    const next: Date[] = [];
    for (let i = 0; i < previewCount; i++) {
      next.push(interval.next().toDate());
    }
    return { valid: true, next };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid cron expression",
    };
  }
}

type ScheduleEventFields = Pick<
  Event,
  | "scheduleKind"
  | "scheduleNumber"
  | "scheduleUnit"
  | "customSchedule"
  | "timezone"
  | "startTime"
>;

/**
 * Build a ScheduleSpec from an event row. Legacy rows have NULL scheduleKind
 * and derive it from customSchedule presence. Returns null when the event has
 * no expressible schedule (CRON kind without an expression).
 */
export function specFromEvent(event: ScheduleEventFields): ScheduleSpec | null {
  const kind =
    event.scheduleKind ??
    (event.customSchedule ? ScheduleKind.CRON : ScheduleKind.INTERVAL);

  if (kind === ScheduleKind.CRON) {
    if (!event.customSchedule) return null;
    return {
      kind,
      cronExpr: event.customSchedule,
      timezone: event.timezone || "UTC",
      startAt: event.startTime ?? null,
    };
  }

  const intervalSeconds = intervalSecondsFor(
    event.scheduleNumber,
    event.scheduleUnit,
  );
  if (validateIntervalSeconds(intervalSeconds)) return null;

  return {
    kind,
    intervalSeconds,
    timezone: event.timezone || "UTC",
    startAt: event.startTime ?? null,
  };
}

type ScheduleWorkflowFields = Pick<
  Workflow,
  "scheduleNumber" | "scheduleUnit" | "customSchedule"
>;

/** Workflows have no timezone/policy columns yet. Legacy workflow rows may
 * contain lowercase interval units, which normalize through intervalSecondsFor. */
export function specFromWorkflow(
  workflow: ScheduleWorkflowFields,
): ScheduleSpec | null {
  if (workflow.customSchedule) {
    return {
      kind: ScheduleKind.CRON,
      cronExpr: workflow.customSchedule,
      timezone: "UTC",
    };
  }
  if (workflow.scheduleNumber === null || !workflow.scheduleUnit) return null;

  const intervalSeconds = intervalSecondsFor(
    workflow.scheduleNumber,
    workflow.scheduleUnit,
  );
  if (validateIntervalSeconds(intervalSeconds)) return null;

  return {
    kind: ScheduleKind.INTERVAL,
    intervalSeconds,
    timezone: "UTC",
  };
}

/**
 * The next fire instant strictly after `from` (or at `from`'s clamped floor).
 *
 * - `prevNext` is the previously materialized tick (events.nextRunAt at the
 *   moment of dispatch); passing it keeps INTERVAL cadence anchored to the
 *   schedule rather than to dispatch latency.
 * - A future `startAt` is itself the first tick (activation at a start time
 *   runs *at* that time, then recurs — the review's C3 semantics, correctly).
 *
 * Returns null only for inexpressible specs (bad cron).
 */
export function computeNextRun(
  spec: ScheduleSpec,
  opts: { from: Date; prevNext?: Date | null },
): Date | null {
  const { from, prevNext } = opts;
  const fromMs = from.getTime();
  if (!Number.isFinite(fromMs)) return null;

  let floor: Date | null = null;
  if (spec.startAt) {
    const startAtMs = spec.startAt.getTime();
    if (!Number.isFinite(startAtMs)) return null;
    if (startAtMs > fromMs) floor = spec.startAt;
  }

  if (spec.kind === ScheduleKind.INTERVAL) {
    const intervalMs = (spec.intervalSeconds ?? 0) * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
    if (floor && !prevNext) return floor;
    const prevNextMs = prevNext?.getTime();
    if (prevNextMs !== undefined && !Number.isFinite(prevNextMs)) return null;
    const base = (prevNextMs ?? fromMs) + intervalMs;
    if (!Number.isFinite(base)) return null;
    const next = new Date(Math.max(base, fromMs));
    return floor && floor.getTime() > next.getTime() ? floor : next;
  }

  if (!spec.cronExpr) return null;
  try {
    // currentDate is exclusive; back off 1ms so a tick exactly at the floor
    // (start time) is included.
    const currentDate = floor ? new Date(floor.getTime() - 1) : from;
    const interval = CronExpressionParser.parse(spec.cronExpr, {
      currentDate,
      tz: spec.timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

/**
 * Grace period before an overdue tick counts as missed. Clamped to the
 * interval so short-interval events can't have a grace that swallows whole
 * ticks (PLAN.md §3.1).
 */
export function effectiveMisfireGraceMs(
  spec: ScheduleSpec,
  misfireGraceS: number,
): number {
  const graceMs = Math.max(0, misfireGraceS) * 1000;
  if (spec.kind === ScheduleKind.INTERVAL && spec.intervalSeconds) {
    return Math.min(graceMs, spec.intervalSeconds * 1000);
  }
  return graceMs;
}

export interface MissedTicksResult {
  /** Scheduled instants strictly after `afterTick` and at or before `until`. */
  ticks: Date[];
  /** True when enumeration stopped at `cap` before reaching `until`. */
  overflowed: boolean;
}

/** Enumerate missed ticks for RUN_ALL catch-up, bounded by `cap`. */
export function missedTicks(
  spec: ScheduleSpec,
  afterTick: Date,
  until: Date,
  cap: number = CATCHUP_RUN_ALL_CAP,
): MissedTicksResult {
  const ticks: Date[] = [];
  const afterTickMs = afterTick.getTime();
  const untilMs = until.getTime();
  if (
    !Number.isFinite(afterTickMs) ||
    !Number.isFinite(untilMs) ||
    untilMs <= afterTickMs ||
    cap <= 0
  ) {
    return { ticks, overflowed: false };
  }

  if (spec.kind === ScheduleKind.INTERVAL) {
    const intervalMs = (spec.intervalSeconds ?? 0) * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return { ticks, overflowed: false };
    }
    let t = afterTickMs + intervalMs;
    while (t <= untilMs) {
      if (ticks.length >= cap) return { ticks, overflowed: true };
      ticks.push(new Date(t));
      t += intervalMs;
    }
    return { ticks, overflowed: false };
  }

  if (!spec.cronExpr) return { ticks, overflowed: false };
  try {
    const interval = CronExpressionParser.parse(spec.cronExpr, {
      currentDate: afterTick,
      tz: spec.timezone,
    });
    for (;;) {
      const next = interval.next().toDate();
      if (next.getTime() > until.getTime()) break;
      if (ticks.length >= cap) return { ticks, overflowed: true };
      ticks.push(next);
    }
    return { ticks, overflowed: false };
  } catch {
    return { ticks, overflowed: false };
  }
}
