import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCapability } from "@/lib/security/internal-route-auth";

// What the runtime actually sends (BackendClient.AuditLog in
// apps/runtime/cronium-runtime/internal/service/backend.go): executionId,
// action, an optional metadata map (JSON null when the action carries none),
// and an RFC3339 timestamp. `details` is a legacy alias for metadata.
const auditEventSchema = z.object({
  executionId: z.string().min(1),
  action: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  details: z.record(z.string(), z.unknown()).nullish(),
  timestamp: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Per-job capability (HI-10): a runtime-fired audit event must carry a
    // valid job capability. It's fire-and-forget logging, so a valid token
    // (any of the execution capabilities) is sufficient — no per-resource
    // scope beyond a live, correctly-signed token.
    const auth = authorizeCapability(request, "execution:read");
    if (!auth.ok) return auth.response;

    const parsed = auditEventSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid audit event" },
        { status: 400 },
      );
    }
    const body = parsed.data;

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
