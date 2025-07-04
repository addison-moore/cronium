import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";
import {
  ConnectionType,
  LogStatus,
  EventStatus,
  WorkflowTriggerType,
  WorkflowLogLevel,
} from "@/shared/schema";
import { scheduleJob, RecurrenceRule, Job } from "node-schedule";

export class WorkflowExecutor {
  private jobs: Map<number, Job> = new Map();
  private isInitialized = false;

  constructor() {}

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Load active workflows from the database
      const activeWorkflows = await storage.getAllWorkflows("*");
      const activeScheduledWorkflows = activeWorkflows.filter(
        (wf) =>
          wf.status === EventStatus.ACTIVE &&
          wf.triggerType === WorkflowTriggerType.SCHEDULE,
      );

      // Schedule each active workflow
      for (const workflow of activeScheduledWorkflows) {
        await this.scheduleWorkflow(workflow.id);
      }

      this.isInitialized = true;
      console.log(
        `Workflow executor initialized with ${activeScheduledWorkflows.length} active workflows`,
      );

      // Handle graceful shutdown
      process.on("SIGTERM", () => {
        this.shutdown();
      });

      process.on("SIGINT", () => {
        this.shutdown();
      });
    } catch (error) {
      console.error("Failed to initialize workflow executor:", error);
      throw error;
    }
  }

  private shutdown() {
    console.log("Shutting down workflow executor...");
    this.jobs.forEach((job, workflowId) => {
      console.log(`Cancelling scheduled job for workflow ${workflowId}`);
      job.cancel();
    });
    this.jobs.clear();
  }

  async scheduleWorkflow(workflowId: number) {
    try {
      // Cancel existing job if it exists
      if (this.jobs.has(workflowId)) {
        this.jobs.get(workflowId)!.cancel();
        this.jobs.delete(workflowId);
      }

      // Get workflow details
      const workflow = await storage.getWorkflow(workflowId);
      if (!workflow) {
        console.log(
          `Workflow with ID ${workflowId} not found, skipping scheduling`,
        );
        return;
      }

      // Only schedule active workflows with valid trigger types
      if (
        workflow.status !== EventStatus.ACTIVE ||
        workflow.triggerType !== WorkflowTriggerType.SCHEDULE
      ) {
        console.log(
          `Workflow ${workflowId} is not scheduled, skipping scheduling`,
        );
        return;
      }

      // Create the schedule based on the workflow configuration
      let rule: RecurrenceRule | string;

      if (workflow.customSchedule) {
        // Use custom cron schedule if provided
        rule = workflow.customSchedule;
      } else if (workflow.scheduleNumber && workflow.scheduleUnit) {
        // Create a recurrence rule based on the schedule number and unit
        rule = new RecurrenceRule();

        const scheduleNum = workflow.scheduleNumber || 1; // Default to 1 if null
        switch (workflow.scheduleUnit) {
          case "SECONDS":
            rule.second = new Array(Math.floor(60 / scheduleNum))
              .fill(null)
              .map((_, i) => i * scheduleNum);
            break;
          case "MINUTES":
            rule.minute = new Array(Math.floor(60 / scheduleNum))
              .fill(null)
              .map((_, i) => i * scheduleNum);
            break;
          case "HOURS":
            rule.hour = new Array(Math.floor(24 / scheduleNum))
              .fill(null)
              .map((_, i) => i * scheduleNum);
            break;
          case "DAYS":
            rule.dayOfWeek = new Array(Math.floor(7 / scheduleNum))
              .fill(null)
              .map((_, i) => i * scheduleNum);
            break;
          default:
            throw new Error(
              `Unsupported schedule unit: ${workflow.scheduleUnit}`,
            );
        }
      } else {
        console.log(
          `Workflow ${workflowId} has no valid schedule configuration`,
        );
        return;
      }

      // Schedule the job
      const job = scheduleJob(rule, async () => {
        console.log(`Executing scheduled workflow: ${workflow.name}`);
        await this.executeWorkflow(workflowId);
      });

      this.jobs.set(workflowId, job);
      console.log(`Scheduled workflow ${workflowId}: ${workflow.name}`);
    } catch (error) {
      console.error(`Error scheduling workflow ${workflowId}:`, error);
      throw error;
    }
  }

  async executeWorkflow(
    workflowId: number,
    userId?: string,
    inputData: Record<string, any> = {},
  ) {
    console.log(`Executing workflow ${workflowId} with input:`, inputData);

    const startTime = new Date();
    let workflowExecution: any = null;

    try {
      // Get workflow details
      const workflow = await storage.getWorkflow(workflowId);
      if (!workflow) {
        throw new Error(`Workflow with ID ${workflowId} not found`);
      }

      const executionUserId = userId || workflow.userId;

      // Create workflow execution record
      workflowExecution = await storage.createWorkflowExecution({
        workflowId: workflow.id,
        userId: executionUserId,
        status: LogStatus.RUNNING,
        triggerType: "MANUAL",
        startedAt: startTime,
        executionData: {
          triggerType: "MANUAL",
          triggeredAt: startTime.toISOString(),
          inputData: inputData,
        },
      });

      console.log(
        `Created workflow execution with ID: ${workflowExecution.id}`,
      );

      // Return execution ID immediately and continue execution in background
      this.executeWorkflowInBackground(
        workflow,
        workflowExecution,
        executionUserId,
        startTime,
        inputData,
      );

      return {
        success: true,
        executionId: workflowExecution.id,
        status: "RUNNING",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Error starting workflow ${workflowId}:`, error);

      return {
        success: false,
        output: errorMessage,
        executionId: workflowExecution?.id,
      };
    }
  }

  private async executeWorkflowInBackground(
    workflow: any,
    workflowExecution: any,
    executionUserId: string,
    startTime: Date,
    inputData: Record<string, any> = {},
  ) {
    try {
      // Create a log entry for this execution
      const log = await storage.createWorkflowLog({
        workflowId: workflow.id,
        userId: executionUserId,
        status: LogStatus.RUNNING,
        level: WorkflowLogLevel.INFO,
        message: `Starting workflow execution: ${workflow.name}`,
        startTime: new Date(),
        output: "Workflow execution started...",
        timestamp: new Date(),
      });

      // Get all nodes and connections
      const nodes = await storage.getWorkflowNodes(workflow.id);
      const connections = await storage.getWorkflowConnections(workflow.id);

      if (nodes.length === 0) {
        const completedAt = new Date();
        const duration = completedAt.getTime() - startTime.getTime();

        // Update workflow execution
        await storage.updateWorkflowExecution(workflowExecution.id, {
          status: LogStatus.FAILURE,
          completedAt,
          totalDuration: duration,
          totalEvents: 0,
          successfulEvents: 0,
          failedEvents: 0,
        });

        await storage.updateWorkflowLog(log.id, {
          status: LogStatus.FAILURE,
          endTime: new Date(),
          output: "Workflow has no nodes to execute",
          error: "No nodes found in workflow",
          level: WorkflowLogLevel.WARNING,
          message: "Workflow has no nodes to execute",
        });
        return;
      }

      // Identify starting nodes (nodes with no incoming connections)
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));
      const incomingConnections = new Map();

      // Build a map of incoming connections for each node
      for (const connection of connections) {
        if (!incomingConnections.has(connection.targetNodeId)) {
          incomingConnections.set(connection.targetNodeId, []);
        }
        incomingConnections.get(connection.targetNodeId).push(connection);
      }

      // Find starting nodes (no incoming connections)
      const startingNodes = nodes.filter(
        (node) => !incomingConnections.has(node.id),
      );

      if (startingNodes.length === 0) {
        const completedAt = new Date();
        const duration = completedAt.getTime() - startTime.getTime();

        // Update workflow execution
        await storage.updateWorkflowExecution(workflowExecution.id, {
          status: LogStatus.FAILURE,
          completedAt,
          totalDuration: duration,
          totalEvents: nodes.length,
          successfulEvents: 0,
          failedEvents: nodes.length,
        });

        await storage.updateWorkflowLog(log.id, {
          status: LogStatus.FAILURE,
          endTime: new Date(),
          output: "Workflow has no valid starting nodes",
          error: "No starting nodes found in workflow",
          level: WorkflowLogLevel.WARNING,
          message: "Workflow has circular dependency - no starting nodes",
        });
        return;
      }

      // Log info about starting nodes
      await storage.createWorkflowLog({
        workflowId: workflow.id,
        userId: workflow.userId,
        level: WorkflowLogLevel.INFO,
        message: `Found ${startingNodes.length} starting nodes in workflow`,
        timestamp: new Date(),
      });

      // Create a map to track node results with script output data
      const nodeResults = new Map<
        number,
        {
          success: boolean;
          output: string;
          scriptOutput?: any;
          condition?: boolean;
        }
      >();

      // Execute the workflow by starting with the starting nodes
      let sequenceOrder = 1;
      for (const startNode of startingNodes) {
        await this.executeNode(
          startNode,
          nodeMap,
          connections,
          nodeResults,
          workflow,
          workflowExecution.id,
          sequenceOrder++,
          inputData,
        );
      }

      // Calculate execution duration
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Determine if the workflow was successful (all nodes succeeded)
      const allNodesSucceeded = Array.from(nodeResults.values()).every(
        (result) => result.success,
      );

      // Calculate success/failure counts
      const totalEvents = nodeResults.size;
      const successfulEvents = Array.from(nodeResults.values()).filter(
        (result) => result.success,
      ).length;
      const failedEvents = totalEvents - successfulEvents;

      // Update workflow execution record
      await storage.updateWorkflowExecution(workflowExecution.id, {
        status: allNodesSucceeded ? LogStatus.SUCCESS : LogStatus.FAILURE,
        completedAt: endTime,
        totalDuration: duration,
        totalEvents,
        successfulEvents,
        failedEvents,
      });

      // Aggregate node outputs for the log
      const aggregatedOutput = Array.from(nodeResults.entries())
        .map(([nodeId, { success, output }]) => {
          const node = nodeMap.get(nodeId);
          return `Node ${node?.id} (Event ${node?.eventId}): ${success ? "SUCCESS" : "FAILURE"}\n${output}\n`;
        })
        .join("\n---\n");

      // Update the log with execution results
      await storage.updateWorkflowLog(log.id, {
        status: allNodesSucceeded ? LogStatus.SUCCESS : LogStatus.FAILURE,
        endTime: endTime,
        output: aggregatedOutput,
        level: allNodesSucceeded
          ? WorkflowLogLevel.INFO
          : WorkflowLogLevel.ERROR,
        message: allNodesSucceeded
          ? `Workflow completed successfully in ${duration}ms`
          : `Workflow completed with failures in ${duration}ms`,
      });

      // Create a final log entry
      await storage.createWorkflowLog({
        workflowId: workflow.id,
        userId: workflow.userId,
        level: allNodesSucceeded
          ? WorkflowLogLevel.INFO
          : WorkflowLogLevel.ERROR,
        message: `Completed workflow execution: ${workflow.name} (${allNodesSucceeded ? "Success" : "Failure"})`,
        timestamp: new Date(),
      });

      console.log(
        `Workflow ${workflow.id} execution completed successfully in background`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(
        `Error executing workflow ${workflow.id} in background:`,
        error,
      );

      // Update workflow execution if it exists
      if (workflowExecution) {
        const completedAt = new Date();
        const duration = completedAt.getTime() - startTime.getTime();

        await storage.updateWorkflowExecution(workflowExecution.id, {
          status: LogStatus.FAILURE,
          completedAt,
          totalDuration: duration,
          totalEvents: 0,
          successfulEvents: 0,
          failedEvents: 0,
        });
      }

      // Create error log
      await storage.createWorkflowLog({
        workflowId: workflow.id,
        userId: executionUserId,
        level: WorkflowLogLevel.ERROR,
        message: `Workflow execution error: ${errorMessage}`,
        timestamp: new Date(),
        status: LogStatus.FAILURE,
        output: errorMessage,
        error: errorMessage,
      });
    }
  }

  private async executeNode(
    node: any,
    nodeMap: Map<number, any>,
    connections: any[],
    nodeResults: Map<
      number,
      {
        success: boolean;
        output: string;
        scriptOutput?: any;
        condition?: boolean;
      }
    >,
    workflow: any,
    workflowExecutionId?: number,
    sequenceOrder?: number,
    initialInputData: Record<string, any> = {},
  ): Promise<void> {
    // Check if this node has already been executed
    if (nodeResults.has(node.id)) {
      return;
    }

    try {
      // Check if all prerequisite nodes have been completed
      const incomingConnections = connections.filter(
        (conn) => conn.targetNodeId === node.id,
      );

      // Wait for all prerequisite nodes to complete
      if (incomingConnections.length > 0) {
        const prerequisiteCompleted = incomingConnections.every((conn) => {
          const sourceNodeResult = nodeResults.get(conn.sourceNodeId);
          if (!sourceNodeResult) return false;

          // Check connection condition
          switch (conn.connectionType) {
            case ConnectionType.ON_SUCCESS:
              return sourceNodeResult.success;
            case ConnectionType.ON_FAILURE:
              return !sourceNodeResult.success;
            case ConnectionType.ON_CONDITION:
              return sourceNodeResult.condition === true;
            case ConnectionType.ALWAYS:
            default:
              return true;
          }
        });

        if (!prerequisiteCompleted) {
          // Log that this node is waiting for prerequisites
          await storage.createWorkflowLog({
            workflowId: workflow.id,
            userId: workflow.userId,
            level: WorkflowLogLevel.INFO,
            message: `Node ${node.id} waiting for prerequisite nodes to complete`,
            timestamp: new Date(),
          });
          return;
        }
      }

      // Execute the node's event
      const event = await storage.getEvent(node.eventId);
      if (!event) {
        const errorMessage = `Event ${node.eventId} not found for node ${node.id}`;
        nodeResults.set(node.id, {
          success: false,
          output: errorMessage,
          condition: false,
        });

        await storage.createWorkflowLog({
          workflowId: workflow.id,
          userId: workflow.userId,
          level: WorkflowLogLevel.ERROR,
          message: errorMessage,
          timestamp: new Date(),
        });
        return;
      }

      console.log(
        `Executing event ${event.id} as part of workflow ${workflow.id}`,
      );

      // Resolve input parameters from dependency nodes and initial workflow input
      const resolvedInputData = this.resolveInputParams(
        node,
        incomingConnections,
        nodeResults,
        initialInputData,
      );
      console.log(
        `Workflow ${workflow.id}: Node ${node.id} resolved input data:`,
        resolvedInputData,
      );

      // Record execution start time
      const executionStartTime = new Date();

      // Execute the event using scheduler with input data
      const executionResult = await scheduler.executeEvent(
        event.id,
        workflowExecutionId,
        sequenceOrder,
        resolvedInputData,
        workflow.id,
      );

      // Record execution end time and calculate duration
      const executionEndTime = new Date();
      const executionDuration =
        executionResult.duration ||
        executionEndTime.getTime() - executionStartTime.getTime();

      // Store the result with script output data
      console.log(
        `Workflow ${workflow.id}: Node ${node.id} execution result:`,
        {
          success: executionResult.success,
          output: executionResult.output || "",
          scriptOutput: executionResult.scriptOutput,
          condition: executionResult.condition,
        },
      );

      nodeResults.set(node.id, {
        success: executionResult.success,
        output: executionResult.output || "",
        ...(executionResult.scriptOutput !== undefined && { scriptOutput: executionResult.scriptOutput }),
        ...(executionResult.condition !== undefined && { condition: executionResult.condition }),
      });

      // Create a workflow execution event record
      if (workflowExecutionId) {
        await storage.createWorkflowExecutionEvent({
          workflowExecutionId,
          eventId: event.id,
          nodeId: node.id,
          sequenceOrder: sequenceOrder || 1,
          status: executionResult.success
            ? LogStatus.SUCCESS
            : LogStatus.FAILURE,
          startedAt: executionStartTime,
          completedAt: executionEndTime,
          duration: executionDuration, // Now properly calculated in milliseconds
          output: executionResult.output || "",
          errorMessage: executionResult.success
            ? null
            : executionResult.output || "Unknown error",
          connectionType: ConnectionType.ALWAYS,
        });
      }

      // Log the node execution result
      await storage.createWorkflowLog({
        workflowId: workflow.id,
        userId: workflow.userId,
        level: executionResult.success
          ? WorkflowLogLevel.INFO
          : WorkflowLogLevel.ERROR,
        message: `Node ${node.id} (Event ${event.name}): ${executionResult.success ? "SUCCESS" : "FAILURE"}`,
        timestamp: new Date(),
      });

      // Execute connected nodes
      const outgoingConnections = connections.filter(
        (conn) => conn.sourceNodeId === node.id,
      );

      for (const connection of outgoingConnections) {
        const targetNode = nodeMap.get(connection.targetNodeId);
        if (targetNode) {
          // Check if this connection should be followed
          const nodeResult = nodeResults.get(node.id);
          const shouldFollow =
            connection.connectionType === ConnectionType.ALWAYS ||
            (connection.connectionType === ConnectionType.ON_SUCCESS &&
              nodeResult?.success) ||
            (connection.connectionType === ConnectionType.ON_FAILURE &&
              !nodeResult?.success) ||
            (connection.connectionType === ConnectionType.ON_CONDITION &&
              nodeResult?.condition === true);

          if (shouldFollow) {
            await this.executeNode(
              targetNode,
              nodeMap,
              connections,
              nodeResults,
              workflow,
              workflowExecutionId,
              sequenceOrder,
              initialInputData,
            );
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`Error executing node ${node.id}:`, error);

      // Store the error result
      nodeResults.set(node.id, {
        success: false,
        output: errorMessage,
        condition: false,
      });

      // Log the error
      await storage.createWorkflowLog({
        workflowId: workflow.id,
        userId: workflow.userId,
        level: WorkflowLogLevel.ERROR,
        message: `Node ${node.id} execution failed: ${errorMessage}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Resolve input parameters for a node from its dependency nodes
   */
  private resolveInputParams(
    node: any,
    incomingConnections: any[],
    nodeResults: Map<
      number,
      {
        success: boolean;
        output: string;
        scriptOutput?: any;
        condition?: boolean;
      }
    >,
    initialInputData: Record<string, any> = {},
  ): Record<string, any> {
    // If this is the first node (no incoming connections), use initial workflow input
    if (incomingConnections.length === 0) {
      return { ...initialInputData };
    }

    // For nodes with incoming connections, use the output from the most recent successful predecessor
    // This ensures cronium.output() from one event becomes cronium.input() for the next
    let latestOutput: any = {};
    let hasValidOutput = false;

    for (const connection of incomingConnections) {
      const sourceNodeResult = nodeResults.get(connection.sourceNodeId);
      console.log(
        `Workflow input resolution: Checking connection from node ${connection.sourceNodeId}:`,
        sourceNodeResult,
      );

      if (sourceNodeResult && sourceNodeResult.success) {
        // If the source node has scriptOutput (from cronium.output()), use it directly
        if (
          sourceNodeResult.scriptOutput !== undefined &&
          sourceNodeResult.scriptOutput !== null
        ) {
          console.log(
            `Found valid scriptOutput from node ${connection.sourceNodeId}:`,
            sourceNodeResult.scriptOutput,
          );
          latestOutput = sourceNodeResult.scriptOutput;
          hasValidOutput = true;
        } else {
          console.log(
            `Node ${connection.sourceNodeId} has no scriptOutput (undefined or null)`,
          );
        }
      } else {
        console.log(`Node ${connection.sourceNodeId} failed or has no result`);
      }
    }

    // If no valid output from predecessors, fall back to initial workflow input
    if (!hasValidOutput) {
      return { ...initialInputData };
    }

    // Return the latest output directly - this becomes the input for cronium.input()
    return typeof latestOutput === "object" && latestOutput !== null
      ? latestOutput
      : {};
  }

  async runWorkflowImmediately(workflowId: number) {
    return await this.executeWorkflow(workflowId);
  }

  async updateWorkflow(workflowId: number) {
    // Cancel existing scheduled job
    if (this.jobs.has(workflowId)) {
      this.jobs.get(workflowId)!.cancel();
      this.jobs.delete(workflowId);
    }

    // Re-schedule the workflow if it's active and scheduled
    const workflow = await storage.getWorkflow(workflowId);
    if (
      workflow &&
      workflow.status === EventStatus.ACTIVE &&
      workflow.triggerType === WorkflowTriggerType.SCHEDULE
    ) {
      await this.scheduleWorkflow(workflowId);
    }
  }

  async deleteWorkflow(workflowId: number) {
    // Cancel and remove scheduled job
    if (this.jobs.has(workflowId)) {
      this.jobs.get(workflowId)!.cancel();
      this.jobs.delete(workflowId);
    }
  }
}

export const workflowExecutor = new WorkflowExecutor();
