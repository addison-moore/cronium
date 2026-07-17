import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { executionService } from "@/lib/services/execution-service";
import { unifiedIoDebug } from "@/lib/unified-io/debug";
import { MAX_UNIFIED_IO_OUTPUT_BYTES } from "@/lib/unified-io/limits";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
