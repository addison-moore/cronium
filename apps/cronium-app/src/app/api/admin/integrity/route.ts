import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { integrityService } from "@/lib/services/integrity-service";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Check execution-log integrity
export async function GET(request: NextRequest) {
  try {
    // Check authentication - admin only
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = session.user as { role?: string };
    if (user.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    // Get action from query params
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") ?? "check";

    switch (action) {
      case "check": {
        // Check integrity
        const report = await integrityService.checkIntegrity();
        return NextResponse.json(report);
      }

      case "reconcile": {
        // Reconcile statuses
        const count = await integrityService.reconcileStatuses();
        return NextResponse.json({
          success: true,
          reconciled: count,
          message: `Reconciled ${count} log records`,
        });
      }

      case "fix-unlinked": {
        // Fix unlinked logs
        const result = await integrityService.fixUnlinkedLogs();
        return NextResponse.json({
          success: true,
          ...result,
          message: `Linked ${result.linked} logs, ${result.failed} failed`,
        });
      }

      case "cleanup": {
        // Clean up orphaned records
        const result = await integrityService.cleanupOrphans();
        return NextResponse.json({
          success: true,
          ...result,
          message: `Cleaned up ${result.logs} logs and ${result.executions} executions`,
        });
      }

      default:
        return NextResponse.json(
          {
            error:
              "Invalid action. Use: check, reconcile, fix-unlinked, or cleanup",
          },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Error in integrity check:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
