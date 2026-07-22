/**
 * Shared guard for state-changing admin endpoints (security plan Phase 4.1).
 *
 * These POST handlers perform privileged maintenance (reconcile/fix/cleanup) via
 * cookie-authenticated admin sessions, so they must be protected against CSRF
 * and — when the deployment enforces admin MFA — require the actor to have MFA
 * enabled. Callers should also emit an audit line (see `auditAdminAction`).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAdminMfaEnforced } from "@/server/security/authorization";
import { storage } from "@/server/storage";

/**
 * Reject cross-site requests to a state-changing endpoint. Prefers the Fetch
 * Metadata `Sec-Fetch-Site` signal (sent by all modern browsers) and falls back
 * to an Origin/Referer host comparison. A state-changing request with no origin
 * signal at all is rejected (fail closed).
 */
export function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) {
    // "none" = user-initiated (address bar); "same-origin" = our own page.
    return site === "same-origin" || site === "none";
  }
  const origin =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * Common gate for state-changing admin routes: same-origin (CSRF) + MFA-enabled
 * when admin MFA is enforced. Returns an error response to return directly, or
 * null when the request may proceed.
 */
export async function guardAdminMutation(
  request: NextRequest,
  userId: string,
): Promise<NextResponse | null> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site request rejected" },
      { status: 403 },
    );
  }
  if (isAdminMfaEnforced()) {
    const actor = await storage.getUser(userId);
    if (!actor?.mfaEnabled) {
      return NextResponse.json(
        {
          error: "This action requires the Admin account to have MFA enabled.",
        },
        { status: 403 },
      );
    }
  }
  return null;
}

/** Durable audit line for a privileged admin action (captured by the log pipeline). */
export function auditAdminAction(
  userId: string,
  action: string,
  result: "ok" | "error",
): void {
  console.warn(
    `[SECURITY-AUDIT] admin-action actor=${userId} action=${action} result=${result}`,
  );
}
