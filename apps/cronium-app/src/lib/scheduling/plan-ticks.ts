/**
 * Pure tick planning for the dispatcher (PLAN.md §4.1): given a due event's
 * schedule spec and the current instant, decide which ticks to dispatch, which
 * incidents to record, and the next materialized run time. No I/O — unit
 * tested with fixed clocks.
 */

import { CatchupPolicy, ScheduleIncidentKind } from "@/shared/schema";
import {
  CATCHUP_RUN_ALL_CAP,
  computeNextRun,
  effectiveMisfireGraceMs,
  missedTicks,
  type ScheduleSpec,
} from "./schedule-math";

export interface PlannedTick {
  at: Date;
  /** Dispatched late, past the misfire grace (marks jobs.scheduledMiss). */
  miss: boolean;
}

export interface PlannedIncident {
  kind: ScheduleIncidentKind;
  details: Record<string, unknown>;
}

export interface TickPlan {
  ticks: PlannedTick[];
  incidents: PlannedIncident[];
  /** New events.next_run_at; null means the schedule is inexpressible and the
   * event should stop being polled (an incident says why). */
  nextRunAt: Date | null;
}

export function planTicks(args: {
  spec: ScheduleSpec;
  dueAt: Date;
  now: Date;
  catchupPolicy: CatchupPolicy;
  misfireGraceS: number;
}): TickPlan {
  const { spec, dueAt, now, catchupPolicy, misfireGraceS } = args;
  const overdueMs = now.getTime() - dueAt.getTime();
  const graceMs = effectiveMisfireGraceMs(spec, misfireGraceS);

  // On time (within grace): one tick, cadence anchored to the schedule.
  if (overdueMs <= graceMs) {
    return {
      ticks: [{ at: dueAt, miss: false }],
      incidents: [],
      nextRunAt: computeNextRun(spec, { from: now, prevNext: dueAt }),
    };
  }

  // Misfire. Enumerate what else was missed between dueAt and now (bounded).
  const elapsed = missedTicks(spec, dueAt, now, CATCHUP_RUN_ALL_CAP - 1);
  const lastElapsed =
    elapsed.ticks.length > 0 ? elapsed.ticks[elapsed.ticks.length - 1]! : dueAt;
  const totalElapsedCount = 1 + elapsed.ticks.length;

  switch (catchupPolicy) {
    case CatchupPolicy.SKIP: {
      return {
        ticks: [],
        incidents: [
          {
            kind: ScheduleIncidentKind.MISSED,
            details: {
              scheduledFor: dueAt.toISOString(),
              missedTicks: totalElapsedCount,
              ...(elapsed.overflowed && { missedTicksTruncated: true }),
            },
          },
        ],
        // Resume from the future; anchor to the last elapsed tick so cadence
        // is preserved (unless enumeration overflowed — then re-anchor to now).
        nextRunAt: computeNextRun(spec, {
          from: now,
          prevNext: elapsed.overflowed ? null : lastElapsed,
        }),
      };
    }

    case CatchupPolicy.RUN_ONCE: {
      const folded = totalElapsedCount - 1;
      return {
        ticks: [{ at: dueAt, miss: true }],
        incidents:
          folded > 0
            ? [
                {
                  kind: ScheduleIncidentKind.MISSED,
                  details: {
                    scheduledFor: dueAt.toISOString(),
                    foldedIntoSingleRun: folded,
                    ...(elapsed.overflowed && { missedTicksTruncated: true }),
                  },
                },
              ]
            : [],
        nextRunAt: computeNextRun(spec, {
          from: now,
          prevNext: elapsed.overflowed ? null : lastElapsed,
        }),
      };
    }

    case CatchupPolicy.RUN_ALL: {
      const ticks: PlannedTick[] = [
        { at: dueAt, miss: true },
        ...elapsed.ticks.map((at) => ({ at, miss: true })),
      ];
      const incidents: PlannedIncident[] = [];
      if (elapsed.overflowed) {
        // Never replay an unbounded backlog: dispatch the cap, drop the rest
        // loudly, and re-anchor to now.
        incidents.push({
          kind: ScheduleIncidentKind.CATCHUP_OVERFLOW,
          details: {
            scheduledFor: dueAt.toISOString(),
            dispatched: ticks.length,
            cap: CATCHUP_RUN_ALL_CAP,
          },
        });
      }
      return {
        ticks,
        incidents,
        nextRunAt: computeNextRun(spec, {
          from: now,
          prevNext: elapsed.overflowed ? null : lastElapsed,
        }),
      };
    }
  }
}
