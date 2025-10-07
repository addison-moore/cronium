// Workflow execution module
import type {
  WorkflowLog,
  InsertWorkflowLog,
  WorkflowExecution,
  InsertWorkflowExecution,
  WorkflowExecutionEvent,
  InsertWorkflowExecutionEvent,
  WorkflowExecutionEventWithDetails,
} from "../types";
import {
  workflowLogs,
  workflowExecutions,
  workflowExecutionEvents,
  workflows,
  events,
} from "@shared/schema";
import { db } from "../../db";
import { eq, desc, count } from "drizzle-orm";

export class WorkflowExecutionStorage {
  // Workflow log methods
  async getWorkflowLog(id: number): Promise<WorkflowLog | undefined> {
    const [log] = await db
      .select()
      .from(workflowLogs)
      .where(eq(workflowLogs.id, id));
    return log;
  }

  async getWorkflowLogs(
    workflowId: number,
    limit = 10,
    page = 1,
  ): Promise<{ logs: WorkflowLog[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countResult] = await db
      .select({ count: count() })
      .from(workflowLogs)
      .where(eq(workflowLogs.workflowId, workflowId));

    const total = Number(countResult?.count) ?? 0;

    const logResults = await db
      .select()
      .from(workflowLogs)
      .where(eq(workflowLogs.workflowId, workflowId))
      .orderBy(desc(workflowLogs.timestamp))
      .limit(limit)
      .offset(offset);

    return { logs: logResults, total };
  }

  async createWorkflowLog(insertLog: InsertWorkflowLog): Promise<WorkflowLog> {
    const [log] = await db.insert(workflowLogs).values(insertLog).returning();

    if (!log) {
      throw new Error("Failed to create workflow log");
    }
    return log;
  }

  async updateWorkflowLog(
    id: number,
    updateData: Partial<InsertWorkflowLog>,
  ): Promise<WorkflowLog> {
    const [log] = await db
      .update(workflowLogs)
      .set(updateData)
      .where(eq(workflowLogs.id, id))
      .returning();

    if (!log) {
      throw new Error("Failed to update workflow log - log not found");
    }
    return log;
  }

  // Workflow execution methods
  async getWorkflowExecution(
    id: number,
  ): Promise<WorkflowExecution | undefined> {
    const [execution] = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.id, id));
    return execution;
  }

  async getWorkflowExecutions(
    workflowId: number,
    limit = 50,
    page = 1,
  ): Promise<{
    executions: (WorkflowExecution & { workflowName?: string })[];
    total: number;
  }> {
    const offset = (page - 1) * limit;

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
        workflowName: workflows.name,
      })
      .from(workflowExecutions)
      .leftJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflowExecutions.workflowId, workflowId))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, workflowId));

    return {
      executions: executions.map((exec) => {
        const { workflowName, ...rest } = exec;
        return workflowName ? { ...rest, workflowName } : rest;
      }) as (WorkflowExecution & { workflowName?: string })[],
      total: totalResult?.count ?? 0,
    };
  }

  async createWorkflowExecution(
    insertExecution: InsertWorkflowExecution,
  ): Promise<WorkflowExecution> {
    const [execution] = await db
      .insert(workflowExecutions)
      .values(insertExecution)
      .returning();

    if (!execution) {
      throw new Error("Failed to create workflow execution");
    }
    return execution;
  }

  async updateWorkflowExecution(
    id: number,
    updateData: Partial<InsertWorkflowExecution>,
  ): Promise<WorkflowExecution> {
    const [execution] = await db
      .update(workflowExecutions)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, id))
      .returning();

    if (!execution) {
      throw new Error(
        "Failed to update workflow execution - execution not found",
      );
    }
    return execution;
  }

  async getAllWorkflowExecutions(
    userId: string,
    limit = 50,
    page = 1,
  ): Promise<{
    executions: (WorkflowExecution & { workflowName?: string })[];
    total: number;
  }> {
    const offset = (page - 1) * limit;

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
        workflowName: workflows.name,
      })
      .from(workflowExecutions)
      .leftJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflowExecutions.userId, userId))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.userId, userId));

    return {
      executions: executions.map((exec) => {
        const { workflowName, ...rest } = exec;
        return workflowName ? { ...rest, workflowName } : rest;
      }) as (WorkflowExecution & { workflowName?: string })[],
      total: totalResult?.count ?? 0,
    };
  }

  // Workflow execution event methods
  async createWorkflowExecutionEvent(
    insertEvent: InsertWorkflowExecutionEvent,
  ): Promise<WorkflowExecutionEvent> {
    const [event] = await db
      .insert(workflowExecutionEvents)
      .values(insertEvent)
      .returning();

    if (!event) {
      throw new Error("Failed to create workflow execution event");
    }
    return event;
  }

  async getWorkflowExecutionEvents(
    executionId: number,
  ): Promise<WorkflowExecutionEventWithDetails[]> {
    const eventsData = await db
      .select({
        id: workflowExecutionEvents.id,
        workflowExecutionId: workflowExecutionEvents.workflowExecutionId,
        eventId: workflowExecutionEvents.eventId,
        nodeId: workflowExecutionEvents.nodeId,
        sequenceOrder: workflowExecutionEvents.sequenceOrder,
        status: workflowExecutionEvents.status,
        startedAt: workflowExecutionEvents.startedAt,
        completedAt: workflowExecutionEvents.completedAt,
        duration: workflowExecutionEvents.duration,
        output: workflowExecutionEvents.output,
        errorMessage: workflowExecutionEvents.errorMessage,
        connectionType: workflowExecutionEvents.connectionType,
        eventName: events.name, // Include event name
        eventType: events.type, // Include event type
      })
      .from(workflowExecutionEvents)
      .leftJoin(events, eq(workflowExecutionEvents.eventId, events.id))
      .where(eq(workflowExecutionEvents.workflowExecutionId, executionId))
      .orderBy(workflowExecutionEvents.sequenceOrder);

    return eventsData as WorkflowExecutionEventWithDetails[];
  }

  async updateWorkflowExecutionEvent(
    id: number,
    updateData: Partial<InsertWorkflowExecutionEvent>,
  ): Promise<WorkflowExecutionEvent> {
    const [event] = await db
      .update(workflowExecutionEvents)
      .set(updateData)
      .where(eq(workflowExecutionEvents.id, id))
      .returning();

    if (!event) {
      throw new Error(
        "Failed to update workflow execution event - event not found",
      );
    }
    return event;
  }

  // User workflow executions
  async getUserWorkflowExecutions(
    userId: string,
    limit?: number,
  ): Promise<WorkflowExecution[]> {
    // Get all workflow executions for a user's workflows in a single query
    const query = db
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
      })
      .from(workflowExecutions)
      .innerJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflows.userId, userId))
      .orderBy(desc(workflowExecutions.createdAt));

    if (limit) {
      query.limit(limit);
    }

    const executions = await query;
    return executions;
  }
}
