"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

interface SchedulerHealth {
  healthy: boolean;
  workerId?: string;
  lastHeartbeatAt?: string;
  neverSeen?: boolean;
}

const POLL_MS = 60_000;

/**
 * Persistent warning when the scheduling worker's heartbeat is stale
 * (_plans/scheduling/PLAN.md §4.5): a dead worker means no scheduled jobs run,
 * and that must be loud, not silent. Renders nothing while healthy or until a
 * definitive health response arrives.
 */
export function SchedulerStatusBanner() {
  const [health, setHealth] = useState<SchedulerHealth | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { scheduler?: SchedulerHealth };
        if (!cancelled && body.scheduler) {
          setHealth(body.scheduler);
        }
      } catch {
        // Network hiccup: keep the last known state rather than flapping
      }
    };

    void check();
    const id = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!health || health.healthy) return null;

  return (
    <div
      role="alert"
      className="relative z-40 flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Scheduling is offline — no scheduled events or tool actions will run.
        {health.neverSeen
          ? " The worker process has never connected; make sure the cronium-worker service is running."
          : " The worker process has stopped sending heartbeats; check the cronium-worker service."}
      </span>
    </div>
  );
}
