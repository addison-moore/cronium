import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { workflows } from "@/shared/schema";
import { eq, and, or } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authenticateApiRequest } from "@/lib/api-auth";
import { workflowExecutor } from "@/lib/workflow-executor";

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

// POST to execute a workflow
export async function POST(
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

    // Check if user can execute this workflow (must be owner for execution)
    if (workflow.userId !== userId) {
      return new NextResponse(
        JSON.stringify({
          error: "Unauthorized. You can only execute workflows you created.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Parse input data from request body
    let inputData = {};
    try {
      const body = await request.text();
      if (body) {
        const parsedBody = JSON.parse(body);
        // Check if input is nested under "input" key (like event API) or direct
        inputData = parsedBody.input || parsedBody;
      }
    } catch (parseError) {
      console.log("No input data provided or invalid JSON, using empty input");
    }

    // Execute the workflow with input data
    try {
      const executionResult = await workflowExecutor.executeWorkflow(
        workflowId,
        userId,
        inputData,
      );

      return NextResponse.json({
        success: true,
        message: "Workflow execution started",
        workflowId: workflowId,
        executionId: executionResult.executionId,
        status: "RUNNING",
      });
    } catch (executionError) {
      console.error(`Error executing workflow ${workflowId}:`, executionError);
      return new NextResponse(
        JSON.stringify({
          error: "Failed to execute workflow",
          details:
            executionError instanceof Error
              ? executionError.message
              : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  } catch (error) {
    console.error("Error in workflow execution endpoint:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
