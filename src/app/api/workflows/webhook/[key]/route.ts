import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { eq, and } from "drizzle-orm";
import { workflows } from "@/shared/schema";
import { WorkflowTriggerType, EventStatus } from "@/shared/schema";
import { workflowExecutor } from "@/lib/workflow-executor";

export async function POST(
  request: NextRequest,
  { params }: { params: { key: string } },
) {
  // Get params - they are already unwrapped in Next.js 15
  const webhookKey = params.key;

  try {
    // Find the workflow associated with this webhook key
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.webhookKey, webhookKey),
          eq(workflows.triggerType, WorkflowTriggerType.WEBHOOK),
        ),
      )
      .limit(1);

    if (!workflow) {
      return NextResponse.json(
        {
          success: false,
          message: "No workflow found for this webhook key",
        },
        { status: 404 },
      );
    }

    if (workflow.status !== EventStatus.ACTIVE) {
      return NextResponse.json(
        {
          success: false,
          message: "This workflow is not active",
        },
        { status: 400 },
      );
    }

    // Get the webhook payload (note: payload is received but not used in current implementation)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const payload: unknown = await request.json().catch(() => ({}));

    console.log(
      `Webhook triggered for workflow ${workflow.id} with key ${webhookKey}`,
    );

    // Run the workflow asynchronously
    workflowExecutor
      .runWorkflowImmediately(workflow.id)
      .then((result) => {
        console.log(
          `Webhook workflow ${workflow.id} execution completed:`,
          result.success ? "SUCCESS" : "FAILURE",
        );
      })
      .catch((error) => {
        console.error(
          `Error running workflow ${workflow.id} via webhook:`,
          error,
        );
      });

    return NextResponse.json({
      success: true,
      message: "Webhook received and workflow execution started",
      workflowId: workflow.id,
    });
  } catch (error) {
    console.error(`Failed to process webhook with key ${webhookKey}:`, error);
    return NextResponse.json(
      { success: false, message: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
