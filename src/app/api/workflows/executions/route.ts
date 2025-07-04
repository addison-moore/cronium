import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { workflowExecutions, workflows } from "@/shared/schema";
import { eq, desc, count } from "drizzle-orm";
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

// GET all workflow executions
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = auth.userId;

    // Get query parameters for pagination
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const offset = (page - 1) * limit;

    // Get workflow executions with workflow information
    // Only include executions from workflows the user has access to
    const executions = await db
      .select({
        id: workflowExecutions.id,
        workflowId: workflowExecutions.workflowId,
        userId: workflowExecutions.userId,
        status: workflowExecutions.status,
        triggerType: workflowExecutions.triggerType,
        startedAt: workflowExecutions.startedAt,
        completedAt: workflowExecutions.completedAt,
        totalDuration: workflowExecutions.totalDuration,
        totalEvents: workflowExecutions.totalEvents,
        successfulEvents: workflowExecutions.successfulEvents,
        failedEvents: workflowExecutions.failedEvents,
        executionData: workflowExecutions.executionData,
        createdAt: workflowExecutions.createdAt,
        updatedAt: workflowExecutions.updatedAt,
        workflow: {
          id: workflows.id,
          name: workflows.name,
        },
      })
      .from(workflowExecutions)
      .innerJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflows.userId, userId)) // Only user's workflows
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [countResult] = await db
      .select({ count: count(workflowExecutions.id) })
      .from(workflowExecutions)
      .innerJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflows.userId, userId));

    const total = countResult?.count ?? 0;

    return NextResponse.json({
      success: true,
      data: {
        executions,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching workflow executions:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
