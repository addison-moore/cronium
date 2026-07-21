/**
 * Worker liveness (PLAN.md §4.5): the worker upserts a heartbeat row from its
 * dispatch loop — so a stalled loop stops heartbeating, not just a dead
 * process — and the app's /api/health + UI banner read it.
 */

import { db } from "@/server/db";
import { systemSettings } from "@/shared/schema";
import { eq } from "drizzle-orm";

export const WORKER_HEARTBEAT_KEY = "schedulerWorkerHeartbeat";
/** Older than this = scheduling is considered offline. */
export const WORKER_HEARTBEAT_STALE_MS = 60_000;

export interface WorkerHeartbeat {
  workerId: string;
  at: string; // ISO
}

export async function writeWorkerHeartbeat(workerId: string): Promise<void> {
  const value = JSON.stringify({
    workerId,
    at: new Date().toISOString(),
  } satisfies WorkerHeartbeat);
  await db
    .insert(systemSettings)
    .values({ key: WORKER_HEARTBEAT_KEY, value })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export interface WorkerHealth {
  healthy: boolean;
  workerId?: string;
  lastHeartbeatAt?: string;
  /** No heartbeat row at all — worker has never run against this database. */
  neverSeen?: boolean;
}

export async function readWorkerHealth(
  now: Date = new Date(),
): Promise<WorkerHealth> {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, WORKER_HEARTBEAT_KEY))
    .limit(1);
  if (!row) return { healthy: false, neverSeen: true };

  try {
    const parsed = JSON.parse(row.value) as WorkerHeartbeat;
    const age = now.getTime() - new Date(parsed.at).getTime();
    return {
      healthy: age < WORKER_HEARTBEAT_STALE_MS,
      workerId: parsed.workerId,
      lastHeartbeatAt: parsed.at,
    };
  } catch {
    return { healthy: false };
  }
}
