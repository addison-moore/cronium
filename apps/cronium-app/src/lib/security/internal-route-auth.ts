import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  verifyJobCapability,
  assertCapability,
  CapabilityError,
  type JobCapability,
  type VerifiedCapability,
} from "./job-capability";

/**
 * Authorization helpers for the job-scoped internal routes (HI-10).
 *
 * The orchestrator presents a per-job capability token (minted by the app at
 * claim time) in the `X-Job-Capability` header. These routes verify that token
 * — signature, expiry, and the specific capability — INSTEAD of the shared
 * `INTERNAL_API_KEY`, and then bind the action to the token's job scope. A
 * leaked service key can no longer act on jobs; only a live, correctly-scoped
 * capability can.
 */

export const JOB_CAPABILITY_HEADER = "x-job-capability";

export type CapabilityResult =
  { ok: true; cap: VerifiedCapability } | { ok: false; response: NextResponse };

/**
 * Verify the capability token in the request header carries `capability`.
 * Does NOT bind a job id — the caller asserts resource scope separately with
 * `assertJobScope` (path job id) once it knows which job/execution it touches.
 */
export function authorizeCapability(
  request: NextRequest,
  capability: JobCapability,
): CapabilityResult {
  const token = request.headers.get(JOB_CAPABILITY_HEADER);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing job capability token" },
        { status: 401 },
      ),
    };
  }
  try {
    const cap = verifyJobCapability(token, Math.floor(Date.now() / 1000));
    assertCapability(cap, capability);
    return { ok: true, cap };
  } catch (error) {
    if (error instanceof CapabilityError) {
      // Uniform 403 — never distinguish bad-signature / expired / wrong-cap to
      // a caller.
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    throw error;
  }
}

/**
 * Assert the verified token is scoped to `jobId`. Returns an error response to
 * short-circuit with, or null when the scope matches.
 */
export function assertJobScope(
  cap: VerifiedCapability,
  jobId: string,
): NextResponse | null {
  if (cap.jobId !== jobId) {
    return NextResponse.json(
      { error: "Capability token is not valid for this job" },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Assert the verified token belongs to `userId` (tenant). Used by the
 * user-variable routes so a job token can only reach its OWNER's variables.
 */
export function assertUserScope(
  cap: VerifiedCapability,
  userId: string,
): NextResponse | null {
  if (cap.userId !== userId) {
    return NextResponse.json(
      { error: "Capability token is not valid for this user" },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Assert the verified token authorizes `serverId` (the job's target server).
 * Used by the server-details route so a job token can only read the connection
 * details of the server it was scheduled against.
 */
export function assertServerScope(
  cap: VerifiedCapability,
  serverId: string,
): NextResponse | null {
  if (!cap.serverId || cap.serverId !== serverId) {
    return NextResponse.json(
      { error: "Capability token is not valid for this server" },
      { status: 403 },
    );
  }
  return null;
}
