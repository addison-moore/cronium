import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { executionService } from "@/lib/services/execution-service";
import { unifiedIoDebug } from "@/lib/unified-io/debug";
import { MAX_UNIFIED_IO_OUTPUT_BYTES } from "@/lib/unified-io/limits";
import {
  authorizeCapability,
  assertJobScope,
} from "@/lib/security/internal-route-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    // Per-job capability (HI-10): a running script writing its own output.
    const auth = authorizeCapability(request, "execution:output");
    if (!auth.ok) return auth.response;

    // Cap the payload so a runaway cronium.output() can't OOM the app or bloat
    // the jobs JSONB column. Reject early on Content-Length, then re-check the
    // serialized size (header can be absent or wrong). The same limit applies to
    // output-producing tool actions (see lib/unified-io/limits.ts).
    const MAX_OUTPUT_BYTES = MAX_UNIFIED_IO_OUTPUT_BYTES;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_OUTPUT_BYTES) {
      return NextResponse.json(
        { error: `Output exceeds the ${MAX_OUTPUT_BYTES}-byte limit` },
        { status: 413 },
      );
    }

    const { executionId } = await params;
    const body = (await request.json()) as {
      output: unknown;
      timestamp: string;
    };

    if (JSON.stringify(body.output ?? null).length > MAX_OUTPUT_BYTES) {
      return NextResponse.json(
        { error: `Output exceeds the ${MAX_OUTPUT_BYTES}-byte limit` },
        { status: 413 },
      );
    }

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

    // Store output in execution metadata
    const updatedMetadata = {
      ...(execution.metadata as Record<string, unknown>),
      output: body.output,
      outputTimestamp: body.timestamp,
    };

    await executionService.updateExecution(executionId, {
      metadata: updatedMetadata,
    });

    // Merge the output into job.result under a row lock so concurrent
    // output()/completion writes serialize instead of clobbering each other
    // (this is a read-modify-write of a JSONB column).
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
            output: body.output,
            outputTimestamp: body.timestamp,
          },
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, execution.jobId));
    });

    unifiedIoDebug(
      `/output stored for execution ${executionId} (job ${execution.jobId}): ${JSON.stringify(body.output)}`,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving output:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
