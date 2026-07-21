/** Fixed-clock tests for dispatcher tick planning (misfire/catch-up policies). */

import { planTicks } from "../plan-ticks";
import { CATCHUP_RUN_ALL_CAP, type ScheduleSpec } from "../schedule-math";
import {
  CatchupPolicy,
  ScheduleIncidentKind,
  ScheduleKind,
} from "@/shared/schema";

const utc = (s: string) => new Date(s);

const interval = (seconds: number): ScheduleSpec => ({
  kind: ScheduleKind.INTERVAL,
  intervalSeconds: seconds,
  timezone: "UTC",
});

describe("planTicks — on time", () => {
  it("one tick, cadence anchored to the schedule", () => {
    const plan = planTicks({
      spec: interval(60),
      dueAt: utc("2026-07-20T10:00:00Z"),
      now: utc("2026-07-20T10:00:02Z"), // 2s late, within grace
      catchupPolicy: CatchupPolicy.SKIP,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toEqual([
      { at: utc("2026-07-20T10:00:00Z"), miss: false },
    ]);
    expect(plan.incidents).toHaveLength(0);
    expect(plan.nextRunAt?.toISOString()).toBe("2026-07-20T10:01:00.000Z");
  });

  it("grace is clamped to the interval (15s schedule, 60s grace config)", () => {
    // 20s late on a 15s schedule = past the effective 15s grace → misfire
    const plan = planTicks({
      spec: interval(15),
      dueAt: utc("2026-07-20T10:00:00Z"),
      now: utc("2026-07-20T10:00:20Z"),
      catchupPolicy: CatchupPolicy.SKIP,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toHaveLength(0);
    expect(plan.incidents[0]?.kind).toBe(ScheduleIncidentKind.MISSED);
  });
});

describe("planTicks — misfire policies", () => {
  const dueAt = utc("2026-07-20T10:00:00Z");
  const now = utc("2026-07-20T10:05:30Z"); // 5.5 min late on a 1-min schedule

  it("SKIP records one MISSED incident counting all elapsed ticks and resumes in the future", () => {
    const plan = planTicks({
      spec: interval(60),
      dueAt,
      now,
      catchupPolicy: CatchupPolicy.SKIP,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toHaveLength(0);
    expect(plan.incidents).toHaveLength(1);
    expect(plan.incidents[0]!.kind).toBe(ScheduleIncidentKind.MISSED);
    expect(plan.incidents[0]!.details.missedTicks).toBe(6); // 10:00..10:05
    // resumes at the next future tick on the original cadence
    expect(plan.nextRunAt?.toISOString()).toBe("2026-07-20T10:06:00.000Z");
  });

  it("RUN_ONCE dispatches one late tick flagged as a miss and folds the rest", () => {
    const plan = planTicks({
      spec: interval(60),
      dueAt,
      now,
      catchupPolicy: CatchupPolicy.RUN_ONCE,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toEqual([{ at: dueAt, miss: true }]);
    expect(plan.incidents[0]!.details.foldedIntoSingleRun).toBe(5);
    expect(plan.nextRunAt?.toISOString()).toBe("2026-07-20T10:06:00.000Z");
  });

  it("RUN_ALL dispatches every elapsed tick", () => {
    const plan = planTicks({
      spec: interval(60),
      dueAt,
      now,
      catchupPolicy: CatchupPolicy.RUN_ALL,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toHaveLength(6);
    expect(plan.ticks.every((t) => t.miss)).toBe(true);
    expect(plan.incidents).toHaveLength(0);
    expect(plan.nextRunAt?.toISOString()).toBe("2026-07-20T10:06:00.000Z");
  });

  it("RUN_ALL caps a huge backlog, records CATCHUP_OVERFLOW, and re-anchors to now", () => {
    const plan = planTicks({
      spec: interval(60),
      dueAt: utc("2026-07-19T10:00:00Z"), // a day of 1-min ticks
      now,
      catchupPolicy: CatchupPolicy.RUN_ALL,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toHaveLength(CATCHUP_RUN_ALL_CAP);
    expect(plan.incidents[0]!.kind).toBe(ScheduleIncidentKind.CATCHUP_OVERFLOW);
    // re-anchored: next run is one interval from now, not from the backlog
    expect(plan.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(plan.nextRunAt!.getTime() - now.getTime()).toBeLessThanOrEqual(
      60_000,
    );
  });

  it("SKIP with an overflowed enumeration re-anchors to now instead of looping", () => {
    const plan = planTicks({
      spec: interval(60),
      dueAt: utc("2026-07-19T10:00:00Z"),
      now,
      catchupPolicy: CatchupPolicy.SKIP,
      misfireGraceS: 60,
    });
    expect(plan.ticks).toHaveLength(0);
    expect(plan.incidents[0]!.details.missedTicksTruncated).toBe(true);
    expect(plan.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
  });
});
