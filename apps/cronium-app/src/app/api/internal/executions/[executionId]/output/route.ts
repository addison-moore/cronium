import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { executionService } from "@/lib/services/execution-service";

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

    const { executionId } = await params;
    const body = (await request.json()) as {
      output: unknown;
      timestamp: string;
    };

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

    // Also update job's result for backward compatibility
    const existingResult = await db
      .select({ result: jobs.result })
      .from(jobs)
      .where(eq(jobs.id, execution.jobId))
      .limit(1);

    const jobResult =
      (existingResult[0]?.result as Record<string, unknown>) || {};
    const updatedResult = {
      ...jobResult,
      output: body.output,
      outputTimestamp: body.timestamp,
    };

    await db
      .update(jobs)
      .set({
        result: updatedResult,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, execution.jobId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving output:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
