import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { JobStatus } from "@/shared/schema";

// Create a new execution
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
      jobId: string;
      serverId?: number;
      serverName?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Create the execution
    const execution = await executionService.createExecution({
      id: executionId,
      jobId: body.jobId,
      serverId: body.serverId ?? null,
      serverName: body.serverName ?? null,
      status: JobStatus.QUEUED,
      metadata: body.metadata ?? {},
    });

    // Broadcast execution creation via WebSocket
    try {
      const { getWebSocketBroadcaster } = await import(
        "@/lib/websocket-broadcaster"
      );
      const broadcaster = getWebSocketBroadcaster();

      await broadcaster.broadcastExecutionUpdate(executionId, "created", {
        startedAt: execution.createdAt,
      });
    } catch (error) {
      console.error("[Execution API] Error broadcasting creation:", error);
    }

    return NextResponse.json({ success: true, execution });
  } catch (error) {
    console.error("Error creating execution:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
