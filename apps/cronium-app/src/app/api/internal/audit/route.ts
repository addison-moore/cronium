import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyInternalKey } from "@/lib/internal-auth";

export async function POST(request: NextRequest) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      executionId: string;
      action: string;
      // The runtime sends this as `metadata`; accept both for compatibility.
      metadata?: Record<string, unknown>;
      details?: Record<string, unknown>;
    };

    // Execution audit events are structured-logged (captured by the container
    // log pipeline). These are runtime-fired, fire-and-forget, and carry no
    // userId/toolId, so they don't fit the tool_audit_logs table; a dedicated
    // execution-audit table is future work.
    console.info(
      "[audit]",
      JSON.stringify({
        timestamp: new Date().toISOString(),
        executionId: body.executionId,
        action: body.action,
        metadata: body.metadata ?? body.details ?? {},
      }),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging audit event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
