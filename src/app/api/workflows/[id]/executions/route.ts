import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { workflowExecutions, workflows } from "@/shared/schema";
import { eq, and, or, desc, count } from "drizzle-orm";
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

// GET workflow execution history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = auth.userId;
    const unwrappedParams = await params;
    const workflowId = parseInt(unwrappedParams.id, 10);

    if (isNaN(workflowId)) {
      return new NextResponse(
        JSON.stringify({ error: "Invalid workflow ID" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Check if the workflow exists and user has access
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          or(
            eq(workflows.userId, userId), // User's own workflow
            eq(workflows.shared, true), // Shared workflow from others
          ),
        ),
      )
      .limit(1);

    if (!workflow) {
      return new NextResponse(JSON.stringify({ error: "Workflow not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get query parameters for pagination
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const offset = (page - 1) * limit;

    // Get workflow execution history
    const executions = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, workflowId))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [countResult] = await db
      .select({ count: count(workflowExecutions.id) })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, workflowId));

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
