import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/** Timing-safe INTERNAL_API_KEY check for orchestrator-facing routes
 * (review D6 — the old `!==` compare leaked timing). */
export function verifyInternalKey(request: NextRequest): boolean {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.INTERNAL_API_KEY;
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
