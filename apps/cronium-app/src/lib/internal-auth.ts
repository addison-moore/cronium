import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Orchestrator service-identity check (HI-10). The orchestrator-identity routes
 * — claim, heartbeat, and orchestrator/health|heartbeat|metrics — authenticate
 * the orchestrator AS A SERVICE (not a job), so they use a dedicated
 * per-service key rather than a per-job capability.
 *
 * This replaces the former shared `INTERNAL_API_KEY`, which has been retired:
 * job/execution/variable/server routes now require per-job capability tokens,
 * and this key is scoped to only the orchestrator-identity routes. The runtime
 * holds no app credential at all (it presents per-job capabilities).
 */
export function verifyOrchestratorKey(request: NextRequest): boolean {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.CRONIUM_ORCHESTRATOR_KEY;
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
