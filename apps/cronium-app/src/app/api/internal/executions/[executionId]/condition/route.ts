import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { executionService } from "@/lib/services/execution-service";
import {
  authorizeCapability,
  assertJobScope,
} from "@/lib/security/internal-route-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    // Per-job capability (HI-10): setCondition() writes to the job's result.
    const auth = authorizeCapability(request, "execution:output");
    if (!auth.ok) return auth.response;

    const { executionId } = await params;
    const body = (await request.json()) as {
      condition: boolean;
    };

    // Get execution
    const execution = await executionService.getExecution(executionId);
    if (!execution) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 },
      );
    }
    const scopeError = assertJobScope(auth.cap, execution.jobId);
    if (scopeError) return scopeError;

    // Store condition in execution metadata
    const updatedMetadata = {
      ...(execution.metadata as Record<string, unknown>),
      condition: body.condition,
      conditionTimestamp: new Date().toISOString(),
    };

    await executionService.updateExecution(executionId, {
      metadata: updatedMetadata,
    });

    // Mirror the condition onto job.result — that is where workflow
    // ON_CONDITION edges read it from (job-polling-service extracts it, and
    // workflow-executor compares `sourceNodeResult.condition === true`).
    //
    // Key on execution.jobId, NOT executionId: executionId is
    // `exec_<jobID>_<ts>` (orchestrator container/executor.go), so matching it
    // against jobs.id updated zero rows and silently dropped every
    // cronium.setCondition().
    //
    // Row-locked, matching the /output route: this is a read-modify-write of a
    // JSONB column, and a script calling both setCondition() and output() would
    // otherwise race and lose one of them.
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ result: jobs.result })
        .from(jobs)
        .where(eq(jobs.id, execution.jobId))
        .limit(1)
        .for("update");

      const jobResult = (row?.result as Record<string, unknown>) || {};
      await tx
        .update(jobs)
        .set({
          result: {
            ...jobResult,
            condition: body.condition,
            conditionTimestamp: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, execution.jobId));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving condition:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
