import { db } from "@server/db";
import {
  events,
  workflows,
  workflowNodes,
  workflowConnections,
  ConnectionType,
  EventStatus,
  EventType,
  WorkflowTriggerType,
  RunLocation,
  TimeUnit,
} from "@shared/schema";
import { nanoid } from "nanoid";

/**
 * This script seeds the database with sample workflows
 * It creates workflows that connect to existing events/scripts in the database
 */
async function seedWorkflows() {
  console.log("Starting to seed workflows...");

  // First, let's get the default admin user ID
  // We'll need it to associate the workflows with a user
  const adminUser = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, "admin@example.com"),
  });

  if (!adminUser) {
    console.error(
      "Admin user not found. Please run the main seed script first.",
    );
    process.exit(1);
  }

  const userId = adminUser.id;
  console.log(`Using admin user with ID: ${userId}`);

  // Next, let's get all existing scripts/events (now called events)
  const existingScripts = await db.select().from(events);

  if (existingScripts.length === 0) {
    console.error(
      "No scripts found in the database. Please create some scripts first.",
    );
    process.exit(1);
  }

  console.log(
    `Found ${existingScripts.length} existing scripts/events to use in workflows`,
  );

  // Check if we already have workflows
  const existingWorkflows = await db.select().from(workflows);

  if (existingWorkflows.length > 0) {
    console.log(
      `Found ${existingWorkflows.length} existing workflows. Skipping seeding.`,
    );
    process.exit(0);
  }

  // Create sample workflows

  // 1. Daily Report Workflow (scheduled)
  const dailyReportWorkflow = await createWorkflow({
    name: "Daily Report Generator",
    description: "Generates and emails daily summary reports",
    triggerType: WorkflowTriggerType.SCHEDULE,
    userId,
    scheduleNumber: 24,
    scheduleUnit: TimeUnit.HOURS,
    status: EventStatus.ACTIVE,
  });

  if (dailyReportWorkflow) {
    console.log(
      `Created daily report workflow with ID: ${dailyReportWorkflow.id}`,
    );
  } else {
    console.error("Failed to create daily report workflow");
    return;
  }

  // Find scripts for the workflow
  const backupScript = findScriptByTypeAndName(
    existingScripts,
    EventType.BASH,
    "Backup",
  );
  const reportScript = findScriptByTypeAndName(
    existingScripts,
    EventType.PYTHON,
    "Generate Report",
  );
  const emailScript = findScriptByTypeAndName(
    existingScripts,
    EventType.NODEJS,
    "Send Email",
  );

  // If we have the scripts, create the nodes and connections
  if (backupScript && reportScript && emailScript) {
    // Create nodes
    const backupNode = await createWorkflowNode({
      workflowId: dailyReportWorkflow!.id,
      eventId: backupScript.id,
      position_x: 100,
      position_y: 100,
    });

    const reportNode = await createWorkflowNode({
      workflowId: dailyReportWorkflow!.id,
      eventId: reportScript.id,
      position_x: 400,
      position_y: 100,
    });

    const emailNode = await createWorkflowNode({
      workflowId: dailyReportWorkflow!.id,
      eventId: emailScript.id,
      position_x: 700,
      position_y: 100,
    });

    if (!backupNode || !reportNode || !emailNode) {
      console.error("Failed to create workflow nodes");
      return;
    }

    // Create connections
    await createWorkflowConnection({
      workflowId: dailyReportWorkflow!.id,
      sourceNodeId: backupNode.id,
      targetNodeId: reportNode.id,
      connectionType: ConnectionType.ON_SUCCESS,
    });

    await createWorkflowConnection({
      workflowId: dailyReportWorkflow!.id,
      sourceNodeId: reportNode.id,
      targetNodeId: emailNode.id,
      connectionType: ConnectionType.ALWAYS,
    });

    console.log("Created nodes and connections for daily report workflow");
  } else {
    console.log(
      "Could not find all required scripts for daily report workflow",
    );
  }

  // 2. API Health Check Workflow (webhook triggered)
  const webhookKey = nanoid(16);
  const healthCheckWorkflow = await createWorkflow({
    name: "API Health Monitor",
    description:
      "Checks the health of various APIs and sends alerts if any are down",
    triggerType: WorkflowTriggerType.WEBHOOK,
    userId,
    webhookKey,
    status: EventStatus.ACTIVE,
  });

  if (healthCheckWorkflow) {
    console.log(
      `Created health check workflow with ID: ${healthCheckWorkflow.id}`,
    );
    console.log(`Webhook key: ${webhookKey}`);
  } else {
    console.error("Failed to create health check workflow");
    return;
  }

  // Find scripts for the workflow
  const apiCheckScript = findScriptByTypeAndName(
    existingScripts,
    EventType.HTTP_REQUEST,
    "API Check",
  );
  const notifyScript = findScriptByTypeAndName(
    existingScripts,
    EventType.NODEJS,
    "Send Notification",
  );
  const logScript = findScriptByTypeAndName(
    existingScripts,
    EventType.BASH,
    "Log Event",
  );

  // If we have the scripts, create the nodes and connections
  if (apiCheckScript && notifyScript && logScript) {
    // Create nodes
    const apiNode = await createWorkflowNode({
      workflowId: healthCheckWorkflow!.id,
      eventId: apiCheckScript.id,
      position_x: 100,
      position_y: 100,
    });

    const notifyNode = await createWorkflowNode({
      workflowId: healthCheckWorkflow!.id,
      eventId: notifyScript.id,
      position_x: 400,
      position_y: 50,
    });

    const logNode = await createWorkflowNode({
      workflowId: healthCheckWorkflow!.id,
      eventId: logScript.id,
      position_x: 400,
      position_y: 200,
    });

    if (!apiNode || !notifyNode || !logNode) {
      console.error("Failed to create workflow nodes");
      return;
    }

    // Create connections
    await createWorkflowConnection({
      workflowId: healthCheckWorkflow!.id,
      sourceNodeId: apiNode.id,
      targetNodeId: notifyNode.id,
      connectionType: ConnectionType.ON_FAILURE,
    });

    await createWorkflowConnection({
      workflowId: healthCheckWorkflow!.id,
      sourceNodeId: apiNode.id,
      targetNodeId: logNode.id,
      connectionType: ConnectionType.ALWAYS,
    });

    console.log("Created nodes and connections for health check workflow");
  } else {
    console.log(
      "Could not find all required scripts for health check workflow",
    );
  }

  // 3. User Onboarding Workflow (manual trigger)
  const onboardingWorkflow = await createWorkflow({
    name: "New User Onboarding",
    description:
      "Set up new user accounts with required permissions and send welcome email",
    triggerType: WorkflowTriggerType.MANUAL,
    userId,
    status: EventStatus.DRAFT,
  });

  if (!onboardingWorkflow) {
    console.error("Failed to create onboarding workflow");
    return;
  }

  console.log(`Created onboarding workflow with ID: ${onboardingWorkflow.id}`);

  // Find scripts for the workflow
  const createUserScript = findScriptByTypeAndName(
    existingScripts,
    EventType.PYTHON,
    "Create User",
  );
  const setupPermissionsScript = findScriptByTypeAndName(
    existingScripts,
    EventType.BASH,
    "Set Permissions",
  );
  const welcomeEmailScript = findScriptByTypeAndName(
    existingScripts,
    EventType.NODEJS,
    "Welcome Email",
  );

  // If we have the scripts, create the nodes and connections
  if (createUserScript && setupPermissionsScript && welcomeEmailScript) {
    // Create nodes
    const createUserNode = await createWorkflowNode({
      workflowId: onboardingWorkflow.id,
      eventId: createUserScript.id,
      position_x: 100,
      position_y: 100,
    });

    const permissionsNode = await createWorkflowNode({
      workflowId: onboardingWorkflow.id,
      eventId: setupPermissionsScript.id,
      position_x: 400,
      position_y: 100,
    });

    const welcomeNode = await createWorkflowNode({
      workflowId: onboardingWorkflow.id,
      eventId: welcomeEmailScript.id,
      position_x: 700,
      position_y: 100,
    });

    // Create connections
    if (createUserNode && permissionsNode && welcomeNode) {
      await createWorkflowConnection({
        workflowId: onboardingWorkflow.id,
        sourceNodeId: createUserNode.id,
        targetNodeId: permissionsNode.id,
        connectionType: ConnectionType.ON_SUCCESS,
      });

      await createWorkflowConnection({
        workflowId: onboardingWorkflow.id,
        sourceNodeId: permissionsNode.id,
        targetNodeId: welcomeNode.id,
        connectionType: ConnectionType.ON_SUCCESS,
      });
    } else {
      console.error("Failed to create workflow nodes for onboarding workflow");
    }

    console.log("Created nodes and connections for onboarding workflow");
  } else {
    console.log("Could not find all required scripts for onboarding workflow");
  }

  console.log("Successfully seeded workflows!");
}

// Helper function to create a workflow
async function createWorkflow(data: any) {
  const [workflow] = await db
    .insert(workflows)
    .values({
      ...data,
      runLocation: RunLocation.LOCAL,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return workflow;
}

// Helper function to create a workflow node
async function createWorkflowNode(data: any) {
  const [node] = await db
    .insert(workflowNodes)
    .values({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return node;
}

// Helper function to create a workflow connection
async function createWorkflowConnection(data: any) {
  const [connection] = await db
    .insert(workflowConnections)
    .values({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return connection;
}

// Helper function to find a script by type and partial name
function findScriptByTypeAndName(
  scriptsList: any[],
  type: EventType,
  partialName: string,
) {
  return scriptsList.find(
    (script) =>
      script.type === type &&
      script.name.toLowerCase().includes(partialName.toLowerCase()),
  );
}

// If this file is run directly, execute the seed function
if (require.main === module) {
  seedWorkflows()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Error seeding workflows:", error);
      process.exit(1);
    });
}

export { seedWorkflows };
