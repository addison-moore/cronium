import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";

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

    // Update job's result with the output
    const job = await db
      .select({ id: jobs.id, result: jobs.result })
      .from(jobs)
      .where(eq(jobs.id, executionId))
      .limit(1);

    if (!job || job.length === 0) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 },
      );
    }

    // Merge output into existing result
    const existingResult = (job[0].result as Record<string, unknown>) || {};
    const updatedResult = {
      ...existingResult,
      output: body.output,
      outputTimestamp: body.timestamp,
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
    console.error("Error saving output:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
