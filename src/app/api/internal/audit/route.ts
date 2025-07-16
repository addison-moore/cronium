import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      executionId: string;
      action: string;
      details?: Record<string, unknown>;
    };

    // For now, just log the audit event
    // In production, this would go to a proper audit log storage
    console.log("Audit Log:", {
      timestamp: new Date().toISOString(),
      executionId: body.executionId,
      action: body.action,
      details: body.details,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging audit event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
