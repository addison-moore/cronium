/**
 * Admin endpoint for manually triggering cleanup of stuck workflows and jobs
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCleanupService } from "@/lib/services/workflow-cleanup-service";
import { UserRole } from "@/shared/schema";

export async function GET() {
  // Check authentication
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  // Check authentication
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      type?: "workflow" | "job" | "all";
      id?: string | number;
    };

    const service = getCleanupService();

    if (body.type === "workflow" && body.id) {
      // Clean specific workflow
      await service.cleanupWorkflow(Number(body.id));
      return NextResponse.json({
        message: `Workflow ${body.id} marked as timed out`,
      });
    } else if (body.type === "job" && body.id) {
      // Clean specific job
      await service.cleanupJob(String(body.id));
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
