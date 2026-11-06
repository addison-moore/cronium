import { NextResponse, type NextRequest } from "next/server";
import { executeErrorResponse, parseExecuteRequest } from "@/lib/api-execute";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { assertEventRelations } from "@/server/security/resource-access";
import { storage } from "@/server/storage";

/**
 * Queue a manual run of an event. The REST counterpart of tRPC's
 * `events.execute`, through the same single enqueue path. It answers once the job
 * is queued; the run's outcome lands on the returned log.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const parsed = await parseExecuteRequest(request, rawId, "events.execute");
    if (!parsed.ok) return parsed.response;
    const { id, userId, input } = parsed;

    await assertEventRelations(id, userId, "execute");

    const event = await storage.getEventWithRelations(id);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const result = await dispatchEventJob(event, {
      triggeredBy: "manual",
      input,
      authorizedUserId: userId,
      actor: `user:${userId}`,
    });

    if (result.skipped) {
      return NextResponse.json(
        {
          error:
            "A previous run of this event is still active (overlap policy: SKIP)",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: true, logId: result.logId, jobId: result.job.id },
      { status: 202 },
    );
  } catch (error) {
    return executeErrorResponse(error, "Event");
  }
}
