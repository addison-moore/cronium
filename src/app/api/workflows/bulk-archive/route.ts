import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { eq, and, inArray } from "drizzle-orm";
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

// Archive multiple workflows
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workflowIds } = await request.json();

    if (!Array.isArray(workflowIds) || workflowIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid workflow IDs array" },
        { status: 400 },
      );
    }

    // Validate all workflow IDs are numbers
    const validIds = workflowIds.filter((id) => Number.isInteger(id) && id > 0);
    if (validIds.length === 0) {
      return NextResponse.json(
        { error: "No valid workflow IDs provided" },
        { status: 400 },
      );
    }

    // Check if workflows exist and belong to the user
    const existingWorkflows = await db
      .select()
      .from(workflows)
      .where(
        and(inArray(workflows.id, validIds), eq(workflows.userId, auth.userId)),
      );

    if (existingWorkflows.length === 0) {
      return NextResponse.json(
        { error: "No workflows found or unauthorized" },
        { status: 404 },
      );
    }

    // Update workflows status to ARCHIVED
    const updatedWorkflows = await db
      .update(workflows)
      .set({
        status: EventStatus.ARCHIVED,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(
            workflows.id,
            existingWorkflows.map((w) => w.id),
          ),
          eq(workflows.userId, auth.userId),
        ),
      )
      .returning();

    return NextResponse.json({
      success: true,
      archivedCount: updatedWorkflows.length,
      workflows: updatedWorkflows,
    });
  } catch (error) {
    console.error("Error bulk archiving workflows:", error);
    return NextResponse.json(
      { error: "An error occurred while archiving workflows" },
      { status: 500 },
    );
  }
}
