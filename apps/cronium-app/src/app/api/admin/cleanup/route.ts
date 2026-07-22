/**
 * Admin endpoint for manually triggering cleanup of stuck workflows and jobs
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import {
  guardAdminMutation,
  auditAdminAction,
} from "@/lib/security/admin-mutation";
import { getCleanupService } from "@/lib/services/workflow-cleanup-service";

export async function GET(request: NextRequest) {
  const auth = await authenticateRestPrincipal(request, "admin");
  if (!auth.ok) {
    return restPrincipalErrorResponse(auth);
  }

  try {
    const service = getCleanupService();
    const stats = await service.getStuckItemStats();

    return NextResponse.json({
      status: "ok",
      stats,
      message: `Found ${stats.stuckWorkflows} stuck workflows and ${stats.stuckJobs} stuck jobs`,
    });
  } catch (error) {
    console.error("[Cleanup] Error getting stats:", error);
    return NextResponse.json(
      { error: "Failed to get cleanup stats" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRestPrincipal(request, "admin");
  if (!auth.ok) {
    return restPrincipalErrorResponse(auth);
  }
  // State-changing: require same-origin (CSRF) + MFA when enforced, and audit.
  const denied = await guardAdminMutation(request, auth.userId);
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      type?: "workflow" | "job" | "all";
      id?: string | number;
    };

    const service = getCleanupService();

    if (body.type === "workflow" && body.id) {
      // Clean specific workflow
      await service.cleanupWorkflow(Number(body.id));
      auditAdminAction(auth.userId, "cleanup.workflow", "ok");
      return NextResponse.json({
        message: `Workflow ${body.id} marked as timed out`,
      });
    } else if (body.type === "job" && body.id) {
      // Clean specific job
      await service.cleanupJob(String(body.id));
      auditAdminAction(auth.userId, "cleanup.job", "ok");
      return NextResponse.json({
        message: `Job ${body.id} marked as timed out`,
      });
    } else {
      // Run full cleanup
      const statsBefore = await service.getStuckItemStats();

      // Trigger manual cleanup
      const cleanupService = getCleanupService();
      await cleanupService.performCleanup(); // Access method for manual trigger

      const statsAfter = await service.getStuckItemStats();

      auditAdminAction(auth.userId, "cleanup.all", "ok");
      return NextResponse.json({
        message: "Cleanup completed",
        before: statsBefore,
        after: statsAfter,
        cleaned: {
          workflows: statsBefore.stuckWorkflows - statsAfter.stuckWorkflows,
          jobs: statsBefore.stuckJobs - statsAfter.stuckJobs,
        },
      });
    }
  } catch (error) {
    console.error("[Cleanup] Error during manual cleanup:", error);
    return NextResponse.json(
      { error: "Failed to perform cleanup" },
      { status: 500 },
    );
  }
}
