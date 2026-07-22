import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { JobStatus } from "@/shared/schema";
import {
  authorizeCapability,
  assertJobScope,
} from "@/lib/security/internal-route-auth";

// Create a new execution
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
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

    // Per-job capability (HI-10): the token must be scoped to the job this
    // execution belongs to.
    const auth = authorizeCapability(request, "execution:create");
    if (!auth.ok) return auth.response;
    const scopeError = assertJobScope(auth.cap, body.jobId);
    if (scopeError) return scopeError;

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
      const { getWebSocketBroadcaster } =
        await import("@/lib/websocket-broadcaster");
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
