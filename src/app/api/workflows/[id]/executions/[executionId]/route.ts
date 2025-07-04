import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { UserRole } from "@/shared/schema";

/**
 * GET /api/workflows/[id]/executions/[executionId]
 * Get detailed execution information including all events
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const resolvedParams = await params;
    const workflowId = parseInt(resolvedParams.id);
    const executionId = parseInt(resolvedParams.executionId);

    if (isNaN(workflowId) || isNaN(executionId)) {
      return NextResponse.json(
        { error: "Invalid workflow or execution ID" },
        { status: 400 },
      );
    }

    // Check if user has access to this workflow
    const workflow = await storage.getWorkflow(workflowId);
    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Users can only access their own workflows or shared workflows
    // Admins can access any workflow
    const user = await storage.getUser(session.user.id);
    const hasAccess =
      workflow.userId === session.user.id ||
      workflow.shared ||
      user?.role === UserRole.ADMIN;

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get execution details
    const execution = await storage.getWorkflowExecution(executionId);
    if (!execution || execution.workflowId !== workflowId) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 },
      );
    }

    // Get execution events
    const events = await storage.getWorkflowExecutionEvents(executionId);

    return NextResponse.json({
      success: true,
      data: {
        execution,
        events,
      },
    });
  } catch (error) {
    console.error("Error fetching workflow execution details:", error);
    return NextResponse.json(
      { error: "Failed to fetch execution details" },
      { status: 500 },
    );
  }
}
