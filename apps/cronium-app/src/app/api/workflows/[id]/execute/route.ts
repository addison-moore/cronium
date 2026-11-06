import { NextResponse, type NextRequest } from "next/server";
import { executeErrorResponse, parseExecuteRequest } from "@/lib/api-execute";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { assertWorkflowGraphCapability } from "@/server/security/resource-access";
import { WorkflowTriggerType } from "@/shared/schema";

/**
 * Start a manual run of a workflow. The REST counterpart of tRPC's
 * `workflows.execute`: the engine creates the run and dispatches its starting
 * nodes, and the scheduling worker advances it from there.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const parsed = await parseExecuteRequest(
      request,
      rawId,
      "workflows.execute",
    );
    if (!parsed.ok) return parsed.response;
    const { id, userId, input } = parsed;

    await assertWorkflowGraphCapability(id, userId, "execute");

    const result = await startWorkflowRun(id, {
      userId,
      triggerType: WorkflowTriggerType.MANUAL,
      input,
    });

    // tRPC returns this as a 200 with `success: false`. Here it has to be an error
    // status, or a CI job using `curl --fail` would pass on a run that never began.
    if (!result.success) {
      return result.notRunnable
        ? NextResponse.json({ error: result.output }, { status: 409 })
        : NextResponse.json(
            { error: "Failed to execute workflow" },
            { status: 500 },
          );
    }

    return NextResponse.json(
      { success: true, executionId: result.executionId, status: result.status },
      { status: 202 },
    );
  } catch (error) {
    return executeErrorResponse(error, "Workflow");
  }
}
