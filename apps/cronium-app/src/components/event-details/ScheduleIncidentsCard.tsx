"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ScheduleIncidentKind } from "@/shared/schema";

const KIND_LABELS: Record<ScheduleIncidentKind, string> = {
  [ScheduleIncidentKind.MISSED]: "Missed run",
  [ScheduleIncidentKind.SKIPPED_OVERLAP]: "Skipped (previous run active)",
  [ScheduleIncidentKind.CATCHUP_OVERFLOW]: "Catch-up truncated",
  [ScheduleIncidentKind.AUTO_PAUSED]: "Auto-paused (max executions)",
  [ScheduleIncidentKind.LEASE_LOST]: "Executor lost mid-run",
};

/**
 * The "didn't run" half of an event's history (PLAN.md §8): scheduled runs
 * that were missed, skipped, or degraded. Renders nothing when there are no
 * incidents — quiet when everything is healthy.
 */
export function ScheduleIncidentsCard({ eventId }: { eventId: number }) {
  const { data } = trpc.events.getScheduleIncidents.useQuery(
    { eventId, limit: 10 },
    { retry: false },
  );

  if (!data || data.incidents.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Schedule incidents
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {data.incidents.map((incident) => {
            const details = (incident.details ?? {}) as Record<string, unknown>;
            const scheduledFor =
              typeof details.scheduledFor === "string"
                ? new Date(details.scheduledFor).toLocaleString()
                : null;
            const reason =
              typeof details.reason === "string" ? details.reason : null;
            const missedTicks =
              typeof details.missedTicks === "number"
                ? details.missedTicks
                : null;
            return (
              <li
                key={incident.id}
                className="border-border flex items-start justify-between gap-4 border-b pb-2 last:border-0 last:pb-0"
              >
                <div>
                  <span className="font-medium">
                    {KIND_LABELS[incident.kind] ?? incident.kind}
                  </span>
                  <div className="text-muted-foreground text-xs">
                    {scheduledFor && <>Scheduled for {scheduledFor}. </>}
                    {missedTicks !== null && missedTicks > 1 && (
                      <>{missedTicks} ticks affected. </>
                    )}
                    {reason && <>{reason}</>}
                  </div>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {new Date(incident.createdAt).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
