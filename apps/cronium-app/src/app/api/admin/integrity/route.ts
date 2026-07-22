import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { integrityService } from "@/lib/services/integrity-service";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import {
  guardAdminMutation,
  auditAdminAction,
} from "@/lib/security/admin-mutation";

// Read-only integrity check. GET must never mutate — the reconcile/fix/cleanup
// actions that used to be reachable here via ?action= moved to POST (below) so
// they cannot be triggered cross-site by a simple GET (Phase 4.1).
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRestPrincipal(request, "admin");
    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
    }
    const report = await integrityService.checkIntegrity();
    return NextResponse.json(report);
  } catch (error) {
    console.error("Error in integrity check:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// State-changing integrity maintenance. Admin-only, same-origin (CSRF), MFA when
// enforced, and audited. The operation is selected by the JSON body `action`.
export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await authenticateRestPrincipal(request, "admin");
    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
    }
    const denied = await guardAdminMutation(request, auth.userId);
    if (denied) return denied;

    const body: unknown = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action;

    switch (action) {
      case "reconcile": {
        const count = await integrityService.reconcileStatuses();
        auditAdminAction(auth.userId, "integrity.reconcile", "ok");
        return NextResponse.json({
          success: true,
          reconciled: count,
          message: `Reconciled ${count} log records`,
        });
      }
      case "fix-unlinked": {
        const result = await integrityService.fixUnlinkedLogs();
        auditAdminAction(auth.userId, "integrity.fix-unlinked", "ok");
        return NextResponse.json({
          success: true,
          ...result,
          message: `Linked ${result.linked} logs, ${result.failed} failed`,
        });
      }
      case "cleanup": {
        const result = await integrityService.cleanupOrphans();
        auditAdminAction(auth.userId, "integrity.cleanup", "ok");
        return NextResponse.json({
          success: true,
          ...result,
          message: `Cleaned up ${result.logs} logs and ${result.executions} executions`,
        });
      }
      default:
        return NextResponse.json(
          {
            error: "Invalid action. Use: reconcile, fix-unlinked, or cleanup",
          },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Error in integrity maintenance:", error);
    if (auth?.ok)
      auditAdminAction(auth.userId, "integrity.maintenance", "error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
