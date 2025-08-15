// Logging operations module
import { db } from "../../db";
import {
  logs,
  events,
  workflows,
  executions,
  LogStatus,
  JobStatus,
} from "../../../shared/schema";
import { eq, and, desc, sql, count, gte, lte } from "drizzle-orm";
import type { Log, InsertLog, LogFilters } from "../types";

export class LogStorage {
  async getLog(id: number): Promise<Log | undefined> {
    const [log] = await db.select().from(logs).where(eq(logs.id, id));

    if (!log) return undefined;

    // If log has a jobId, try to get execution data
    if (log.jobId) {
      // Get the most recent execution for this job
      const [execution] = await db
        .select()
        .from(executions)
        .where(eq(executions.jobId, log.jobId))
        .orderBy(desc(executions.createdAt))
        .limit(1);

      // If execution has output/error and log doesn't, use execution data
      if (execution) {
        if (!log.output && execution.output) {
          log.output = execution.output;
        }
        if (!log.error && execution.error) {
          log.error = execution.error;
        }
        // Also update status if execution has completed but log hasn't
        if (
          log.status === LogStatus.RUNNING &&
          execution.status !== JobStatus.RUNNING &&
          execution.status !== JobStatus.QUEUED
        ) {
          // Map execution status to log status
          if (
            execution.status === JobStatus.COMPLETED &&
            execution.exitCode === 0
          ) {
            log.status = LogStatus.SUCCESS;
          } else if (
            execution.status === JobStatus.FAILED ||
            (execution.status === JobStatus.COMPLETED &&
              execution.exitCode !== 0)
          ) {
            log.status = LogStatus.FAILURE;
          }
        }
      }
    }

    return log;
  }

  async getLatestLogForScript(eventId: number): Promise<Log | undefined> {
    const [log] = await db
      .select()
      .from(logs)
      .where(eq(logs.eventId, eventId))
      .orderBy(desc(logs.startTime))
      .limit(1);

    return log;
  }

  async getAllLogs(
    limit = 10,
    page = 1,
  ): Promise<{ logs: Log[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countResult] = await db.select({ count: count() }).from(logs);
    const total = Number(countResult?.count) ?? 0;

    const logResults = await db
      .select()
      .from(logs)
      .orderBy(desc(logs.startTime))
      .limit(limit)
      .offset(offset);

    return { logs: logResults, total };
  }

  async getLogs(
    eventId: number,
    limit = 10,
    page = 1,
  ): Promise<{ logs: Log[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countResult] = await db
      .select({ count: count() })
      .from(logs)
      .where(eq(logs.eventId, eventId));

    const total = Number(countResult?.count) ?? 0;

    const logResults = await db
      .select()
      .from(logs)
      .where(eq(logs.eventId, eventId))
      .orderBy(desc(logs.startTime))
      .limit(limit)
      .offset(offset);

    return { logs: logResults, total };
  }

  async getLogsByEventId(
    eventId: number,
    options?: { limit?: number; offset?: number },
  ): Promise<{ logs: Log[]; total: number }> {
    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    const [countResult] = await db
      .select({ count: count() })
      .from(logs)
      .where(eq(logs.eventId, eventId));

    const total = Number(countResult?.count) ?? 0;

    const logResults = await db
      .select()
      .from(logs)
      .where(eq(logs.eventId, eventId))
      .orderBy(desc(logs.startTime))
      .limit(limit)
      .offset(offset);

    return { logs: logResults, total };
  }

  async getFilteredLogs(
    filters: LogFilters,
    limit = 20,
    page = 1,
  ): Promise<{ logs: Log[]; total: number }> {
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [];

    if (filters.eventId) {
      conditions.push(eq(logs.eventId, parseInt(filters.eventId)));
    }

    if (filters.status) {
      conditions.push(eq(logs.status, filters.status));
    }

    if (filters.date) {
      const date = new Date(filters.date);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      conditions.push(
        and(gte(logs.startTime, startOfDay), lte(logs.startTime, endOfDay)),
      );
    }

    if (filters.workflowId !== undefined) {
      if (filters.workflowId === null) {
        conditions.push(sql`${logs.workflowId} IS NULL`);
      } else {
        conditions.push(eq(logs.workflowId, filters.workflowId));
      }
    }

    // Handle user access filtering - allow logs from user's own events OR shared events
    if (filters.userId) {
      if (filters.ownEventsOnly) {
        // Show only logs from user's own events (exclude shared events)
        conditions.push(eq(logs.userId, filters.userId));
      } else if (filters.sharedOnly) {
        // Show only logs from shared events (exclude own events)
        // This requires joining with events table to check sharing status
        // We'll handle this in the query join logic below
      } else {
        // Show logs from user's own events AND shared events
        // This requires joining with events table to check sharing status
        // We'll handle this in the query join logic below
      }
    }

    // Apply conditions to count query with events join for user access
    let countQuery;
    if (filters.userId && !filters.ownEventsOnly) {
      // Need to join with events table to check sharing permissions
      let userAccessCondition;

      if (filters.sharedOnly) {
        // Show only shared events (exclude own events)
        userAccessCondition = sql`(${events.userId} != ${filters.userId} AND ${events.shared} = true)`;
      } else {
        // Show own events AND shared events
        userAccessCondition = sql`(${events.userId} = ${filters.userId} OR ${events.shared} = true)`;
      }

      if (conditions.length > 0) {
        countQuery = db
          .select({ count: count() })
          .from(logs)
          .innerJoin(events, eq(logs.eventId, events.id))
          .where(and(...conditions, userAccessCondition));
      } else {
        countQuery = db
          .select({ count: count() })
          .from(logs)
          .innerJoin(events, eq(logs.eventId, events.id))
          .where(userAccessCondition);
      }
    } else {
      if (conditions.length > 0) {
        countQuery = db
          .select({ count: count() })
          .from(logs)
          .where(and(...conditions));
      } else {
        countQuery = db.select({ count: count() }).from(logs);
      }
    }

    const [countResult] = await countQuery;
    const total = Number(countResult?.count) ?? 0;

    // Apply conditions to main query with workflow and events joins
    let query;
    const selectFields = {
      id: logs.id,
      eventId: logs.eventId,
      workflowId: logs.workflowId,
      status: logs.status,
      output: logs.output,
      startTime: logs.startTime,
      endTime: logs.endTime,
      duration: logs.duration,
      successful: logs.successful,
      eventName: logs.eventName,
      eventType: logs.eventType,
      retries: logs.retries,
      error: logs.error,
      userId: logs.userId,
      jobId: logs.jobId,
      executionId: logs.executionId,
      exitCode: logs.exitCode,
      createdAt: logs.createdAt,
      updatedAt: logs.updatedAt,
      workflowName: workflows.name,
    };

    if (filters.userId && !filters.ownEventsOnly) {
      // Need to join with events table to check sharing permissions
      let userAccessCondition;

      if (filters.sharedOnly) {
        // Show only shared events (exclude own events)
        userAccessCondition = sql`(${events.userId} != ${filters.userId} AND ${events.shared} = true)`;
      } else {
        // Show own events AND shared events
        userAccessCondition = sql`(${events.userId} = ${filters.userId} OR ${events.shared} = true)`;
      }

      if (conditions.length > 0) {
        query = db
          .select(selectFields)
          .from(logs)
          .innerJoin(events, eq(logs.eventId, events.id))
          .leftJoin(workflows, eq(logs.workflowId, workflows.id))
          .where(and(...conditions, userAccessCondition));
      } else {
        query = db
          .select(selectFields)
          .from(logs)
          .innerJoin(events, eq(logs.eventId, events.id))
          .leftJoin(workflows, eq(logs.workflowId, workflows.id))
          .where(userAccessCondition);
      }
    } else {
      if (conditions.length > 0) {
        query = db
          .select(selectFields)
          .from(logs)
          .leftJoin(workflows, eq(logs.workflowId, workflows.id))
          .where(and(...conditions));
      } else {
        query = db
          .select(selectFields)
          .from(logs)
          .leftJoin(workflows, eq(logs.workflowId, workflows.id));
      }
    }

    // Add pagination and sorting
    const logsResult = await query
      .orderBy(desc(logs.startTime))
      .limit(limit)
      .offset(offset);

    return { logs: logsResult, total };
  }

  async getDistinctWorkflowsFromLogs(
    userId: string,
  ): Promise<{ id: number; name: string }[]> {
    // Get distinct workflows from logs where user has access (own events or shared events)
    const distinctWorkflows = await db
      .selectDistinct({
        id: workflows.id,
        name: workflows.name,
      })
      .from(logs)
      .innerJoin(events, eq(logs.eventId, events.id))
      .innerJoin(workflows, eq(logs.workflowId, workflows.id))
      .where(
        and(
          sql`${logs.workflowId} IS NOT NULL`,
          sql`(${events.userId} = ${userId} OR ${events.shared} = true)`,
        ),
      )
      .orderBy(workflows.name);

    return distinctWorkflows;
  }

  async createLog(insertLog: InsertLog): Promise<Log> {
    const [log] = await db.insert(logs).values(insertLog).returning();

    if (!log) {
      throw new Error("Failed to create log");
    }
    return log;
  }

  async updateLog(id: number, updateData: Partial<InsertLog>): Promise<Log> {
    const [log] = await db
      .update(logs)
      .set(updateData)
      .where(eq(logs.id, id))
      .returning();

    if (!log) {
      throw new Error("Failed to update log - log not found");
    }
    return log;
  }

  async deleteLog(id: number): Promise<void> {
    await db.delete(logs).where(eq(logs.id, id));
  }
}
