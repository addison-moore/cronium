import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs, executions } from "@/shared/schema";
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

    // Store condition in execution metadata
    const updatedMetadata = {
      ...(execution.metadata as Record<string, unknown>),
      condition: body.condition,
      conditionTimestamp: new Date().toISOString(),
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
      condition: body.condition,
      conditionTimestamp: new Date().toISOString(),
    };

    await db
      .update(jobs)
      .set({
        result: updatedResult,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, executionId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving condition:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
