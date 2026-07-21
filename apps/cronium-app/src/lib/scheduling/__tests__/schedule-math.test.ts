/**
 * Fixed-clock tests for the schedule-math library. These cover the exact bug
 * classes from _plans/scheduling/review.md: C7 (seconds schedules), H4
 * (interval drift at hour/day/month boundaries), H5 (timezones + DST), H6
 * (cron validation).
 */

import {
  computeNextRun,
  effectiveMisfireGraceMs,
  intervalSecondsFor,
  missedTicks,
  specFromEvent,
  validateCronExpr,
  validateIntervalSeconds,
  MIN_INTERVAL_SECONDS,
} from "../schedule-math";
import { ScheduleKind, TimeUnit } from "@/shared/schema";
import type { ScheduleSpec } from "../schedule-math";

const utc = (s: string) => new Date(s);

const interval = (
  seconds: number,
  startAt: Date | null = null,
): ScheduleSpec => ({
  kind: ScheduleKind.INTERVAL,
  intervalSeconds: seconds,
  timezone: "UTC",
  startAt,
});

const cron = (
  expr: string,
  tz = "UTC",
  startAt: Date | null = null,
): ScheduleSpec => ({
  kind: ScheduleKind.CRON,
  cronExpr: expr,
  timezone: tz,
  startAt,
});

describe("intervalSecondsFor / validateIntervalSeconds", () => {
  it("converts each unit", () => {
    expect(intervalSecondsFor(45, TimeUnit.SECONDS)).toBe(45);
    expect(intervalSecondsFor(7, TimeUnit.MINUTES)).toBe(420);
    expect(intervalSecondsFor(5, TimeUnit.HOURS)).toBe(18_000);
    expect(intervalSecondsFor(3, TimeUnit.DAYS)).toBe(259_200);
  });

  it("rejects sub-floor and nonsense intervals", () => {
    expect(validateIntervalSeconds(MIN_INTERVAL_SECONDS)).toBeNull();
    expect(validateIntervalSeconds(9)).toMatch(/not supported/);
    expect(validateIntervalSeconds(0)).toMatch(/positive/);
    expect(validateIntervalSeconds(-5)).toMatch(/positive/);
    expect(validateIntervalSeconds(Number.NaN)).toMatch(/positive/);
  });
});

describe("computeNextRun — INTERVAL (true elapsed time)", () => {
  it("every 45 seconds means 45 elapsed seconds, not once per minute (C7)", () => {
    const spec = interval(45);
    const t0 = utc("2026-07-20T10:00:00Z");
    const n1 = computeNextRun(spec, { from: t0, prevNext: null })!;
    expect(n1.toISOString()).toBe("2026-07-20T10:00:45.000Z");
    const n2 = computeNextRun(spec, { from: n1, prevNext: n1 })!;
    expect(n2.getTime() - n1.getTime()).toBe(45_000);
  });

  it("every 7 minutes stays 420s apart across an hour boundary (H4)", () => {
    const spec = interval(7 * 60);
    let prev = utc("2026-07-20T09:56:00Z");
    for (let i = 0; i < 5; i++) {
      const next = computeNextRun(spec, { from: prev, prevNext: prev })!;
      expect(next.getTime() - prev.getTime()).toBe(420_000);
      prev = next;
    }
    // crossed 10:00 without snapping to slot boundaries
    expect(prev.toISOString()).toBe("2026-07-20T10:31:00.000Z");
  });

  it("every 3 days is exactly 72h across a month boundary (H4)", () => {
    const spec = interval(3 * 86_400);
    const prev = utc("2026-01-30T00:00:00Z");
    const next = computeNextRun(spec, { from: prev, prevNext: prev })!;
    expect(next.toISOString()).toBe("2026-02-02T00:00:00.000Z");
  });

  it("anchors to the schedule, not dispatch latency, but never returns the past", () => {
    const spec = interval(30);
    const prevNext = utc("2026-07-20T10:00:00Z");
    // dispatcher woke up 100s late: next tick would be 10:00:30 (past) → now
    const from = utc("2026-07-20T10:01:40Z");
    const next = computeNextRun(spec, { from, prevNext })!;
    expect(next.getTime()).toBe(from.getTime());
  });

  it("a future start time is itself the first tick (C3 semantics)", () => {
    const startAt = utc("2026-08-01T09:00:00Z");
    const spec = interval(3600, startAt);
    const next = computeNextRun(spec, {
      from: utc("2026-07-20T10:00:00Z"),
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2026-08-01T09:00:00.000Z");
    // and it recurs from there
    const after = computeNextRun(spec, { from: next, prevNext: next })!;
    expect(after.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });
});

describe("computeNextRun — CRON (timezone-aware)", () => {
  it("evaluates in the schedule's timezone (H5)", () => {
    // 9am in New York is 14:00 UTC in winter (EST), 13:00 UTC in summer (EDT)
    const spec = cron("0 9 * * *", "America/New_York");
    const winter = computeNextRun(spec, {
      from: utc("2026-01-15T00:00:00Z"),
      prevNext: null,
    })!;
    expect(winter.toISOString()).toBe("2026-01-15T14:00:00.000Z");
    const summer = computeNextRun(spec, {
      from: utc("2026-07-15T00:00:00Z"),
      prevNext: null,
    })!;
    expect(summer.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("spring-forward: a tick in the DST gap fires at the next valid instant", () => {
    // 2:30 AM does not exist on 2026-03-08 in America/New_York.
    // cron-parser shifts to 3:30 EDT (07:30 UTC), then resumes 2:30 EDT daily.
    const spec = cron("30 2 * * *", "America/New_York");
    const first = computeNextRun(spec, {
      from: utc("2026-03-08T05:00:00Z"),
      prevNext: null,
    })!;
    expect(first.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    const second = computeNextRun(spec, { from: first, prevNext: first })!;
    expect(second.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });

  it("fall-back: a tick in the repeated hour fires once, not twice", () => {
    // 1:30 AM occurs twice on 2026-11-01 in America/New_York; expect one fire
    // (the EDT occurrence, 05:30 UTC), next fire the following day.
    const spec = cron("30 1 * * *", "America/New_York");
    const first = computeNextRun(spec, {
      from: utc("2026-11-01T00:00:00Z"),
      prevNext: null,
    })!;
    expect(first.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    const second = computeNextRun(spec, { from: first, prevNext: first })!;
    expect(second.toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });

  it("honors a future start time as a floor, inclusive", () => {
    const startAt = utc("2026-08-01T09:00:00Z");
    const spec = cron("0 9 * * *", "UTC", startAt);
    const next = computeNextRun(spec, {
      from: utc("2026-07-20T00:00:00Z"),
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("returns null for an invalid expression instead of a silent dead schedule (H6)", () => {
    const spec = cron("not a cron");
    expect(
      computeNextRun(spec, {
        from: utc("2026-07-20T00:00:00Z"),
        prevNext: null,
      }),
    ).toBeNull();
  });
});

describe("validateCronExpr", () => {
  it("accepts valid expressions with a preview", () => {
    const result = validateCronExpr("*/15 * * * *", "UTC");
    expect(result.valid).toBe(true);
    expect(result.next).toHaveLength(5);
  });

  it("rejects garbage with an error message", () => {
    const result = validateCronExpr("banana");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("effectiveMisfireGraceMs", () => {
  it("clamps grace to the interval for short-interval events", () => {
    expect(effectiveMisfireGraceMs(interval(15), 60)).toBe(15_000);
    expect(effectiveMisfireGraceMs(interval(3600), 60)).toBe(60_000);
    expect(effectiveMisfireGraceMs(cron("* * * * *"), 60)).toBe(60_000);
  });
});

describe("missedTicks", () => {
  it("enumerates interval ticks in the overdue window", () => {
    const { ticks, overflowed } = missedTicks(
      interval(60),
      utc("2026-07-20T10:00:00Z"),
      utc("2026-07-20T10:05:00Z"),
    );
    expect(overflowed).toBe(false);
    expect(ticks.map((t) => t.toISOString())).toEqual([
      "2026-07-20T10:01:00.000Z",
      "2026-07-20T10:02:00.000Z",
      "2026-07-20T10:03:00.000Z",
      "2026-07-20T10:04:00.000Z",
      "2026-07-20T10:05:00.000Z",
    ]);
  });

  it("caps enumeration and reports overflow instead of replaying unbounded backlogs", () => {
    const { ticks, overflowed } = missedTicks(
      interval(60),
      utc("2026-07-01T00:00:00Z"),
      utc("2026-07-20T00:00:00Z"),
      10,
    );
    expect(overflowed).toBe(true);
    expect(ticks).toHaveLength(10);
  });

  it("enumerates cron ticks in a timezone", () => {
    const { ticks } = missedTicks(
      cron("0 * * * *", "America/New_York"),
      utc("2026-07-20T10:00:00Z"),
      utc("2026-07-20T13:00:00Z"),
    );
    expect(ticks.map((t) => t.toISOString())).toEqual([
      "2026-07-20T11:00:00.000Z",
      "2026-07-20T12:00:00.000Z",
      "2026-07-20T13:00:00.000Z",
    ]);
  });
});

describe("specFromEvent", () => {
  const base = {
    scheduleKind: null,
    scheduleNumber: 5,
    scheduleUnit: TimeUnit.MINUTES,
    customSchedule: null,
    timezone: "UTC",
    startTime: null,
  };

  it("derives INTERVAL for legacy rows without customSchedule", () => {
    const spec = specFromEvent(base)!;
    expect(spec.kind).toBe(ScheduleKind.INTERVAL);
    expect(spec.intervalSeconds).toBe(300);
  });

  it("derives CRON for legacy rows with customSchedule", () => {
    const spec = specFromEvent({ ...base, customSchedule: "0 9 * * 1" })!;
    expect(spec.kind).toBe(ScheduleKind.CRON);
    expect(spec.cronExpr).toBe("0 9 * * 1");
  });

  it("explicit scheduleKind wins over derivation", () => {
    const spec = specFromEvent({
      ...base,
      scheduleKind: ScheduleKind.INTERVAL,
      customSchedule: "0 9 * * 1",
    })!;
    expect(spec.kind).toBe(ScheduleKind.INTERVAL);
  });

  it("returns null for CRON kind without an expression", () => {
    expect(
      specFromEvent({ ...base, scheduleKind: ScheduleKind.CRON }),
    ).toBeNull();
  });
});
