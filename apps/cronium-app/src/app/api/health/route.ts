import { NextResponse } from "next/server";
import { readWorkerHealth } from "@/lib/scheduling/heartbeat";

// DB read below — never let Next statically optimize this route
export const dynamic = "force-dynamic";

/**
 * App liveness (always 200 when the app itself is up — the container
 * healthcheck and installer depend on that) plus scheduling-worker status for
 * the UI banner (PLAN.md §4.5). A dead worker degrades `scheduler.healthy`,
 * not the HTTP status: the web app is still serving.
 */
export async function GET() {
  let scheduler: Awaited<ReturnType<typeof readWorkerHealth>>;
  try {
    scheduler = await readWorkerHealth();
  } catch {
    scheduler = { healthy: false };
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    scheduler,
  });
}
