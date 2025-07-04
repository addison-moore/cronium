import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { eq, and } from "drizzle-orm";
import { workflows, EventStatus } from "@/shared/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authenticateApiRequest } from "@/lib/api-auth";

// Helper function to authenticate user via session or API token
async function authenticateUser(
  request: NextRequest,
): Promise<{ userId: string } | null> {
  // First try API token
  const apiAuth = await authenticateApiRequest(request);

  if (apiAuth.authenticated && apiAuth.userId) {
    return { userId: apiAuth.userId };
  }

  // Then try session
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return { userId: session.user.id };
  }

  // No authentication found
  return null;
}

// Archive a workflow
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workflowId = parseInt(params.id);
    if (isNaN(workflowId)) {
      return NextResponse.json(
        { error: "Invalid workflow ID" },
        { status: 400 },
      );
    }

    // Check if workflow exists and belongs to the user
    const existingWorkflow = await db
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.id, workflowId), eq(workflows.userId, auth.userId)),
      )
      .limit(1);

    if (existingWorkflow.length === 0) {
      return NextResponse.json(
        { error: "Workflow not found or unauthorized" },
        { status: 404 },
      );
    }

    // Update workflow status to ARCHIVED
    const [updatedWorkflow] = await db
      .update(workflows)
      .set({
        status: EventStatus.ARCHIVED,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, workflowId))
      .returning();

    return NextResponse.json({
      success: true,
      workflow: updatedWorkflow,
    });
  } catch (error) {
    console.error("Error archiving workflow:", error);
    return NextResponse.json(
      { error: "An error occurred while archiving the workflow" },
      { status: 500 },
    );
  }
}

// Unarchive a workflow
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workflowId = parseInt(params.id);
    if (isNaN(workflowId)) {
      return NextResponse.json(
        { error: "Invalid workflow ID" },
        { status: 400 },
      );
    }

    // Check if workflow exists and belongs to the user
    const existingWorkflow = await db
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.id, workflowId), eq(workflows.userId, auth.userId)),
      )
      .limit(1);

    if (existingWorkflow.length === 0) {
      return NextResponse.json(
        { error: "Workflow not found or unauthorized" },
        { status: 404 },
      );
    }

    // Update workflow status to DRAFT (unarchive)
    const [updatedWorkflow] = await db
      .update(workflows)
      .set({
        status: EventStatus.DRAFT,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, workflowId))
      .returning();

    return NextResponse.json({
      success: true,
      workflow: updatedWorkflow,
    });
  } catch (error) {
    console.error("Error unarchiving workflow:", error);
    return NextResponse.json(
      { error: "An error occurred while unarchiving the workflow" },
      { status: 500 },
    );
  }
}
