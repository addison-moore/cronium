/**
 * Admin endpoint for manually triggering cleanup of stuck workflows and jobs
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import {
  guardAdminMutation,
  auditAdminAction,
} from "@/lib/security/admin-mutation";
import { getCleanupService } from "@/lib/services/workflow-cleanup-service";

const MAX_POSTGRES_INT = 2_147_483_647;

// A workflow_executions id, not a workflows id.
const runIdSchema = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number),
  ])
  .pipe(z.number().int().positive().max(MAX_POSTGRES_INT));

// Strict on purpose. A request that named one run or job but got its id wrong must
// not fall through to the full sweep, which times out jobs across the instance.
const cleanupBodySchema = z.union([
  z.object({ type: z.literal("workflow"), id: runIdSchema }).strict(),
  z
    .object({
      type: z.literal("job"),
      id: z.union([z.string().min(1), z.number()]),
    })
    .strict(),
  z.object({ type: z.literal("all").optional() }).strict(),
]);

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

  let auditAction: string | undefined;
  try {
    // An empty or malformed body is refused below, like any other bad request.
    const parsed = cleanupBodySchema.safeParse(
      await request.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            'Expected {"type":"workflow","id":<run id>}, {"type":"job","id":<job id>} or {"type":"all"}',
        },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const service = getCleanupService();

    if (body.type === "workflow") {
      auditAction = "cleanup.workflow";
      const timedOut = await service.cleanupWorkflow(body.id);
      if (!timedOut) {
        auditAdminAction(auth.userId, auditAction, "error");
        return NextResponse.json(
          { error: `No running workflow run with id ${body.id}` },
          { status: 404 },
        );
      }
      auditAdminAction(auth.userId, auditAction, "ok");
      return NextResponse.json({
        message: `Workflow run ${body.id} marked as timed out`,
      });
    } else if (body.type === "job") {
      // Clean specific job
      auditAction = "cleanup.job";
      await service.cleanupJob(String(body.id));
      auditAdminAction(auth.userId, auditAction, "ok");
      return NextResponse.json({
        message: `Job ${body.id} marked as timed out`,
      });
    } else {
      // Run full cleanup
      auditAction = "cleanup.all";
      const statsBefore = await service.getStuckItemStats();

      // Trigger manual cleanup
      const cleanupService = getCleanupService();
      await cleanupService.performCleanup(); // Access method for manual trigger

      const statsAfter = await service.getStuckItemStats();

      auditAdminAction(auth.userId, auditAction, "ok");
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
    if (auditAction) auditAdminAction(auth.userId, auditAction, "error");
    return NextResponse.json(
      { error: "Failed to perform cleanup" },
      { status: 500 },
    );
  }
}
