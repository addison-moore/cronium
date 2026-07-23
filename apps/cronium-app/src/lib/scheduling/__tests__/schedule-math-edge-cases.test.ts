/**
 * @jest-environment node
 */
/**
 * Edge-case extension of schedule-math.test.ts: DST transitions with hourly
 * and interval cadences, month-end / leap-year cron semantics, timezone
 * midnight boundaries, and interval floor/prevNext interactions.
 *
 * Note on TZ: computeNextRun/missedTicks take an explicit IANA timezone in the
 * spec (cron) or operate on pure UTC millisecond arithmetic (interval), and
 * every fixture below is an ISO string with a Z offset, so these tests are
 * independent of process.env.TZ.
 */

import {
  computeNextRun,
  effectiveMisfireGraceMs,
  missedTicks,
  validateCronExpr,
} from "../schedule-math";
import { ScheduleKind } from "@/shared/schema";
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

const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe("DST spring-forward — America/New_York 2026-03-08 (2:00→3:00 gap)", () => {
  it("hourly cron produces a 23-tick local day with no duplicate at the gap", () => {
    // Local hours 00..23 minus the nonexistent 02:00. EST midnight = 05:00Z.
    const { ticks, overflowed } = missedTicks(
      cron("0 * * * *", "America/New_York"),
      utc("2026-03-08T05:00:00Z"), // exclusive: local midnight tick itself
      utc("2026-03-09T04:00:00Z"), // local 23:00 EDT
      50,
    );
    expect(overflowed).toBe(false);
    expect(ticks).toHaveLength(23);
    // Around the gap: 1:00 EST (06:00Z) then 3:00 EDT (07:00Z) — no 2:00,
    // and no double fire at 07:00Z.
    expect(iso(ticks.slice(0, 3))).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
    ]);
    const unique = new Set(iso(ticks));
    expect(unique.size).toBe(ticks.length);
  });

  it("missedTicks for a daily 2:30 schedule shifts the gap day's tick and re-anchors after", () => {
    const { ticks } = missedTicks(
      cron("30 2 * * *", "America/New_York"),
      utc("2026-03-07T07:30:00Z"), // 2:30 EST on Mar 7
      utc("2026-03-09T07:00:00Z"),
    );
    expect(iso(ticks)).toEqual([
      "2026-03-08T07:30:00.000Z", // shifted to 3:30 EDT (2:30 doesn't exist)
      "2026-03-09T06:30:00.000Z", // back to 2:30 EDT
    ]);
  });

  it("interval cadence is unaffected by the gap: exactly 1800s apart in real time", () => {
    const spec = interval(1800);
    let prev = utc("2026-03-08T06:15:00Z"); // 1:15 EST, gap is imminent
    for (let i = 0; i < 4; i++) {
      const next = computeNextRun(spec, { from: prev, prevNext: prev })!;
      expect(next.getTime() - prev.getTime()).toBe(1_800_000);
      prev = next;
    }
    expect(prev.toISOString()).toBe("2026-03-08T08:15:00.000Z");
  });
});

describe("DST fall-back — America/New_York 2026-11-01 (2:00→1:00 repeat)", () => {
  it("hourly cron stays strictly hourly through the 25-hour local day", () => {
    const { ticks } = missedTicks(
      cron("0 * * * *", "America/New_York"),
      utc("2026-11-01T04:00:00Z"), // 0:00 EDT, exclusive
      utc("2026-11-01T08:00:00Z"), // 3:00 EST
      50,
    );
    expect(iso(ticks)).toEqual([
      "2026-11-01T05:00:00.000Z", // 1:00 EDT (first occurrence)
      "2026-11-01T06:00:00.000Z", // 1:00 EST (second occurrence of local 1:00)
      "2026-11-01T07:00:00.000Z", // 2:00 EST
      "2026-11-01T08:00:00.000Z", // 3:00 EST
    ]);
  });

  it("interval cadence is true elapsed time across the repeated hour", () => {
    const spec = interval(3600);
    const prev = utc("2026-11-01T04:30:00Z"); // 0:30 EDT
    const n1 = computeNextRun(spec, { from: prev, prevNext: prev })!;
    const n2 = computeNextRun(spec, { from: n1, prevNext: n1 })!;
    expect(n1.toISOString()).toBe("2026-11-01T05:30:00.000Z"); // 1:30 EDT
    expect(n2.toISOString()).toBe("2026-11-01T06:30:00.000Z"); // 1:30 EST again
  });

  it("daily 1:00 AM schedule fires once on the fall-back day, not twice", () => {
    const spec = cron("0 1 * * *", "America/New_York");
    const first = computeNextRun(spec, {
      from: utc("2026-11-01T00:00:00Z"),
      prevNext: null,
    })!;
    expect(first.toISOString()).toBe("2026-11-01T05:00:00.000Z"); // 1:00 EDT
    const second = computeNextRun(spec, { from: first, prevNext: first })!;
    // Not the 06:00Z repeat of local 1:00 — the next day's 1:00 EST.
    expect(second.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
});

describe("month-end cron semantics", () => {
  it("'31st of the month' skips months without a 31st", () => {
    const spec = cron("0 0 31 * *");
    const next = computeNextRun(spec, {
      from: utc("2026-01-31T12:00:00Z"), // Jan 31 tick already passed
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2026-03-31T00:00:00.000Z"); // no Feb 31
  });

  it("fires on Jan 31 itself when approached from earlier in the month", () => {
    const next = computeNextRun(cron("0 0 31 * *"), {
      from: utc("2026-01-15T00:00:00Z"),
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("enumerates exactly the 7 months with a 31st across a year", () => {
    const { ticks, overflowed } = missedTicks(
      cron("0 0 31 * *"),
      utc("2026-01-01T00:00:00Z"),
      utc("2026-12-31T23:59:59Z"),
      50,
    );
    expect(overflowed).toBe(false);
    expect(iso(ticks)).toEqual([
      "2026-01-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-05-31T00:00:00.000Z",
      "2026-07-31T00:00:00.000Z",
      "2026-08-31T00:00:00.000Z",
      "2026-10-31T00:00:00.000Z",
      "2026-12-31T00:00:00.000Z",
    ]);
  });

  it("Feb 29 schedule waits for the next leap year", () => {
    const next = computeNextRun(cron("0 0 29 2 *"), {
      from: utc("2026-01-01T00:00:00Z"),
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("Feb 28 schedule fires every year including leap years", () => {
    const spec = cron("0 0 28 2 *");
    const first = computeNextRun(spec, {
      from: utc("2027-03-01T00:00:00Z"),
      prevNext: null,
    })!;
    expect(first.toISOString()).toBe("2028-02-28T00:00:00.000Z");
  });

  it("monthly first-of-month crosses the year boundary", () => {
    const next = computeNextRun(cron("0 0 1 * *"), {
      from: utc("2026-12-15T00:00:00Z"),
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("validateCronExpr previews month-end schedules without error", () => {
    const result = validateCronExpr("0 0 31 * *", "UTC", 3);
    expect(result.valid).toBe(true);
    expect(result.next).toHaveLength(3);
  });
});

describe("timezone midnight boundaries", () => {
  it("the same instant yields different 'next midnight' per zone", () => {
    const from = utc("2026-07-20T10:00:00Z");
    const midnight = (tz: string) =>
      computeNextRun(cron("0 0 * * *", tz), { from, prevNext: null })!;

    // UTC: next midnight is tomorrow 00:00Z.
    expect(midnight("UTC").toISOString()).toBe("2026-07-21T00:00:00.000Z");
    // Auckland (NZST, UTC+12 in July): local date is already Jul 20 22:00,
    // next midnight is Jul 21 local = 12:00Z today.
    expect(midnight("Pacific/Auckland").toISOString()).toBe(
      "2026-07-20T12:00:00.000Z",
    );
    // Los Angeles (PDT, UTC-7): local time is 03:00 Jul 20, next midnight is
    // Jul 21 local = 07:00Z tomorrow.
    expect(midnight("America/Los_Angeles").toISOString()).toBe(
      "2026-07-21T07:00:00.000Z",
    );
  });

  it("day-of-week is evaluated in the schedule's zone, not UTC", () => {
    // Sunday 22:00Z is already Monday 07:00 in Tokyo — the Monday-9am tick
    // fires two hours later, at Monday 00:00Z.
    const next = computeNextRun(cron("0 9 * * 1", "Asia/Tokyo"), {
      from: utc("2026-07-19T22:00:00Z"),
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("a late-evening local schedule lands on the next UTC day", () => {
    // Friday 23:00 in New York (EDT) is Saturday 03:00Z.
    const next = computeNextRun(cron("0 23 * * 5", "America/New_York"), {
      from: utc("2026-07-20T00:00:00Z"), // Monday
      prevNext: null,
    })!;
    expect(next.toISOString()).toBe("2026-07-25T03:00:00.000Z");
  });
});

describe("interval floor / prevNext interactions", () => {
  it("a future startAt outranks the prevNext-anchored cadence", () => {
    const startAt = utc("2026-08-01T09:00:00Z");
    const spec = interval(3600, startAt);
    const next = computeNextRun(spec, {
      from: utc("2026-07-20T10:30:00Z"),
      prevNext: utc("2026-07-20T10:00:00Z"),
    })!;
    expect(next.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("a past startAt is ignored and cadence anchors to prevNext", () => {
    const startAt = utc("2026-01-01T00:00:00Z");
    const spec = interval(3600, startAt);
    const prevNext = utc("2026-07-20T10:00:00Z");
    const next = computeNextRun(spec, {
      from: utc("2026-07-20T10:05:00Z"),
      prevNext,
    })!;
    expect(next.toISOString()).toBe("2026-07-20T11:00:00.000Z");
  });

  it("an invalid prevNext yields null instead of a bogus date", () => {
    expect(
      computeNextRun(interval(60), {
        from: utc("2026-07-20T10:00:00Z"),
        prevNext: new Date(Number.NaN),
      }),
    ).toBeNull();
  });

  it("an invalid startAt yields null", () => {
    expect(
      computeNextRun(interval(60, new Date(Number.NaN)), {
        from: utc("2026-07-20T10:00:00Z"),
        prevNext: null,
      }),
    ).toBeNull();
  });
});

describe("misfire grace and missedTicks edge inputs", () => {
  it("negative grace clamps to zero", () => {
    expect(effectiveMisfireGraceMs(interval(3600), -30)).toBe(0);
    expect(effectiveMisfireGraceMs(cron("* * * * *"), -30)).toBe(0);
  });

  it("missedTicks returns empty for inverted or degenerate windows", () => {
    const spec = interval(60);
    expect(
      missedTicks(
        spec,
        utc("2026-07-20T10:05:00Z"),
        utc("2026-07-20T10:00:00Z"),
      ).ticks,
    ).toEqual([]);
    expect(
      missedTicks(
        spec,
        utc("2026-07-20T10:00:00Z"),
        utc("2026-07-20T10:00:00Z"),
      ).ticks,
    ).toEqual([]);
    expect(
      missedTicks(
        spec,
        utc("2026-07-20T10:00:00Z"),
        utc("2026-07-20T10:05:00Z"),
        0,
      ).ticks,
    ).toEqual([]);
  });

  it("missedTicks across the spring-forward gap keeps monotonic UTC order", () => {
    const { ticks } = missedTicks(
      cron("*/30 * * * *", "America/New_York"),
      utc("2026-03-08T06:30:00Z"), // 1:30 EST
      utc("2026-03-08T08:00:00Z"), // 4:00 EDT... actually 3:00+1h window
      50,
    );
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.getTime()).toBeGreaterThan(ticks[i - 1]!.getTime());
    }
    const unique = new Set(iso(ticks));
    expect(unique.size).toBe(ticks.length);
  });
});
