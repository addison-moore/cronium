import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { JobStatus } from "@/shared/schema";

// Update an execution
export async function PUT(
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
      status?: JobStatus;
      startedAt?: string;
      completedAt?: string;
      exitCode?: number;
      output?: string;
      error?: string;
      metadata?: Record<string, unknown>;
    };

    // Convert date strings to Date objects
    const updateData: Parameters<typeof executionService.updateExecution>[1] =
      {};

    if (body.status !== undefined) updateData.status = body.status;
    if (body.startedAt !== undefined)
      updateData.startedAt = new Date(body.startedAt);
    if (body.completedAt !== undefined)
      updateData.completedAt = new Date(body.completedAt);
    if (body.exitCode !== undefined) updateData.exitCode = body.exitCode;
    if (body.output !== undefined) updateData.output = body.output;
    if (body.error !== undefined) updateData.error = body.error;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    // Update the execution
    const execution = await executionService.updateExecution(
      executionId,
      updateData,
    );

    if (!execution) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, execution });
  } catch (error) {
    console.error("Error updating execution:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
