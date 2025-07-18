// Event/Script operations module
import { db } from "../../db";
import {
  events,
  envVars,
  logs,
  servers,
  conditionalActions,
  workflowNodes,
  workflowExecutionEvents,
  eventServers,
  type ConditionalActionType,
  type Event,
  type InsertEvent,
  type EnvVar,
  type InsertEnvVar,
  type ConditionalAction,
  type InsertConditionalAction,
  type Server,
} from "../../../shared/schema";
import {
  eq,
  and,
  or,
  desc,
  sql,
  inArray,
} from "drizzle-orm";
import {
  encryptSensitiveData,
  decryptSensitiveData,
} from "../../../lib/encryption-service";
import type { EventWithRelations } from "../types";

// Type alias for backward compatibility
type Script = Event;

export class EventStorage {
  // Event CRUD methods
  async getEvent(id: number): Promise<Script | undefined> {
    const [script] = await db.select().from(events).where(eq(events.id, id));
    return script ?? undefined;
  }

  async getEventWithRelations(
    id: number,
  ): Promise<EventWithRelations | undefined> {
    // Direct call without caching
    // Optimized implementation with parallel queries
    return this.getEventWithRelationsOptimized(id);
  }

  private async getEventWithRelationsOptimized(
    id: number,
  ): Promise<EventWithRelations | undefined> {
    try {
      // Step 1: Fetch base event with simple relations
      const eventPromise = db.query.events.findFirst({
        where: eq(events.id, id),
        with: {
          envVars: true,
          server: true,
          eventServers: {
            with: {
              server: true,
            },
          },
        },
      });

      // Step 2: Fetch conditional actions in parallel (without deep nesting)
      const conditionalActionsPromises = Promise.all([
        // Success events
        db.query.conditionalActions.findMany({
          where: eq(conditionalActions.successEventId, id),
        }),
        // Fail events
        db.query.conditionalActions.findMany({
          where: eq(conditionalActions.failEventId, id),
        }),
        // Always events
        db.query.conditionalActions.findMany({
          where: eq(conditionalActions.alwaysEventId, id),
        }),
        // Condition events
        db.query.conditionalActions.findMany({
          where: eq(conditionalActions.conditionEventId, id),
        }),
      ]);

      // Execute all queries in parallel
      const [
        event,
        [successEvents, failEvents, alwaysEvents, conditionEvents],
      ] = await Promise.all([eventPromise, conditionalActionsPromises]);

      if (!event) {
        return undefined;
      }

      // Transform the data to match the expected EventWithRelations structure
      const servers =
        event.eventServers
          ?.map((es) => es.server)
          .filter((s): s is Server => s !== null) || [];

      const result: EventWithRelations = {
        ...event,
        servers,
        successEvents: successEvents || [],
        failEvents: failEvents || [],
        alwaysEvents: alwaysEvents || [],
        conditionEvents: conditionEvents || [],
      };

      return result;
    } catch (error) {
      console.error(
        `Error in getEventWithRelationsOptimized for event ${id}:`,
        error,
      );

      // Fallback to simple version on error
      return this.getEventWithRelationsSimple(id);
    }
  }

  private async getEventWithRelationsSimple(
    id: number,
  ): Promise<EventWithRelations | undefined> {
    try {
      // First get the base event
      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return undefined;
      }

      // Fetch only essential related data in parallel
      const [envVarsData, eventServersData] = await Promise.all([
        // Get env vars
        db.query.envVars.findMany({
          where: eq(envVars.eventId, id),
        }),
        // Get event servers with server data
        db.query.eventServers.findMany({
          where: eq(eventServers.eventId, id),
          with: {
            server: true,
          },
        }),
      ]);

      // Get the server if serverId exists
      const serverData = event.serverId
        ? await db.query.servers.findFirst({
            where: eq(servers.id, event.serverId),
          })
        : null;

      // Return simplified structure
      const result: EventWithRelations = {
        ...event,
        envVars: envVarsData ?? [],
        servers: eventServersData?.map((es) => es.server).filter(Boolean) ?? [],
        // Empty arrays for conditional actions to avoid timeout
        successEvents: [],
        failEvents: [],
        alwaysEvents: [],
        conditionEvents: [],
      };

      // Only add server property if we have a server (optional property)
      if (serverData !== undefined) {
        result.server = serverData;
      }

      return result;
    } catch (error) {
      console.error(
        `Error in getEventWithRelationsSimple for event ${id}:`,
        error,
      );
      // Return minimal event data on error
      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return undefined;
      }

      return {
        ...event,
        envVars: [],
        server: null,
        servers: [],
        successEvents: [],
        failEvents: [],
        alwaysEvents: [],
        conditionEvents: [],
      } as EventWithRelations;
    }
  }

  async getActiveEventsWithRelations(): Promise<EventWithRelations[]> {
    const { EventStatus } = await import("@/shared/schema");
    const activeEvents = await db.query.events.findMany({
      where: eq(events.status, EventStatus.ACTIVE),
      with: {
        envVars: true,
        server: true,
        eventServers: {
          with: {
            server: true,
          },
        },
        onSuccessEvents: {
          with: {
            targetEvent: true,
          },
        },
        onFailEvents: {
          with: {
            targetEvent: true,
          },
        },
        onAlwaysEvents: {
          with: {
            targetEvent: true,
          },
        },
      },
    });

    // Get condition events for all active events in one query
    const eventIds = activeEvents.map((e) => e.id);
    const conditionEvents =
      eventIds.length > 0
        ? await db
            .select()
            .from(conditionalActions)
            .where(
              and(
                inArray(conditionalActions.conditionEventId, eventIds),
                eq(
                  conditionalActions.type,
                  "runEvent" as ConditionalActionType,
                ),
              ),
            )
        : [];

    // Create a map for quick lookup
    const conditionEventsByEventId = conditionEvents.reduce(
      (acc, ce) => {
        const conditionEventId = ce.conditionEventId;
        if (conditionEventId) {
          acc[conditionEventId] ??= [];
          acc[conditionEventId].push(ce);
        }
        return acc;
      },
      {} as Record<number, typeof conditionEvents>,
    );

    // Transform the results
    return activeEvents.map((event) => {
      const {
        onSuccessEvents = [],
        onFailEvents = [],
        onAlwaysEvents = [],
        ...eventData
      } = event;

      const transformed: EventWithRelations = {
        ...eventData,
        envVars: event.envVars ?? [],
        server: event.server ?? null,
        servers:
          event.eventServers?.map((es) => es.server).filter(Boolean) ?? [],
        // Map conditional actions from the related events
        successEvents: onSuccessEvents.map((se) => ({
          id: se.id,
          type: se.type,
          value: se.value,
          successEventId: se.successEventId,
          failEventId: se.failEventId,
          alwaysEventId: se.alwaysEventId,
          conditionEventId: se.conditionEventId,
          targetEventId: se.targetEventId,
          toolId: se.toolId,
          message: se.message,
          emailAddresses: se.emailAddresses,
          emailSubject: se.emailSubject,
          createdAt: se.createdAt,
          updatedAt: se.updatedAt,
          targetEvent: se.targetEvent ?? undefined,
        })),
        failEvents: onFailEvents.map((fe) => ({
          id: fe.id,
          type: fe.type,
          value: fe.value,
          successEventId: fe.successEventId,
          failEventId: fe.failEventId,
          alwaysEventId: fe.alwaysEventId,
          conditionEventId: fe.conditionEventId,
          targetEventId: fe.targetEventId,
          toolId: fe.toolId,
          message: fe.message,
          emailAddresses: fe.emailAddresses,
          emailSubject: fe.emailSubject,
          createdAt: fe.createdAt,
          updatedAt: fe.updatedAt,
          targetEvent: fe.targetEvent ?? undefined,
        })),
        alwaysEvents: onAlwaysEvents.map((ae) => ({
          id: ae.id,
          type: ae.type,
          value: ae.value,
          successEventId: ae.successEventId,
          failEventId: ae.failEventId,
          alwaysEventId: ae.alwaysEventId,
          conditionEventId: ae.conditionEventId,
          targetEventId: ae.targetEventId,
          toolId: ae.toolId,
          message: ae.message,
          emailAddresses: ae.emailAddresses,
          emailSubject: ae.emailSubject,
          createdAt: ae.createdAt,
          updatedAt: ae.updatedAt,
          targetEvent: ae.targetEvent ?? undefined,
        })),
        conditionEvents: conditionEventsByEventId[event.id] ?? [],
      };

      return transformed;
    });
  }

  async getAllEvents(userId: string): Promise<Event[]> {
    // Get user's own scripts and shared scripts from other users with all relations in a single query
    const eventsWithRelations = await db.query.events.findMany({
      where: or(eq(events.userId, userId), eq(events.shared, true)),
      orderBy: [desc(events.updatedAt)],
      with: {
        eventServers: {
          columns: {
            serverId: true,
          },
        },
      },
    });

    // Transform to include eventServers array for backward compatibility
    const enrichedScripts = eventsWithRelations.map((event) => ({
      ...event,
      eventServers: event.eventServers.map((es) => es.serverId),
    }));

    return enrichedScripts;
  }

  async getEventsByServerId(
    serverId: number,
    userId: string,
  ): Promise<Event[]> {
    // Get events that are associated with the specified server with all eventServers in a single query
    const eventsWithRelations = await db.query.events.findMany({
      where: and(
        sql`${events.id} IN (
          SELECT ${eventServers.eventId} 
          FROM ${eventServers} 
          WHERE ${eventServers.serverId} = ${serverId}
        )`,
        or(eq(events.userId, userId), eq(events.shared, true)),
      ),
      orderBy: [desc(events.updatedAt)],
      with: {
        eventServers: {
          columns: {
            serverId: true,
          },
        },
      },
    });

    // Transform to include eventServers array for backward compatibility
    const enrichedScripts = eventsWithRelations.map((event) => ({
      ...event,
      eventServers: event.eventServers.map((es) => es.serverId),
    }));

    return enrichedScripts;
  }

  async canViewEvent(eventId: number, userId: string): Promise<boolean> {
    const [script] = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.id, eventId),
          sql`(${events.userId} = ${userId} OR ${events.shared} = true)`,
        ),
      );

    return !!script;
  }

  async canEditEvent(eventId: number, userId: string): Promise<boolean> {
    const [script] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.userId, userId)));

    return !!script;
  }

  async createScript(insertScript: InsertEvent): Promise<Event> {
    const [script] = await db.insert(events).values(insertScript).returning();

    if (!script) {
      throw new Error("Failed to create script");
    }
    return script;
  }

  async updateScript(
    id: number,
    updateData: Partial<InsertEvent>,
  ): Promise<Event> {
    // Special handling for boolean values to ensure they are stored correctly
    if (
      "resetCounterOnActive" in updateData &&
      updateData.resetCounterOnActive !== undefined
    ) {
      // Force the value to be a true boolean to prevent PostgreSQL string conversion
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      (updateData as any).resetCounterOnActive =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        (updateData as any).resetCounterOnActive === true;
      console.log(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        `In storage layer - resetCounterOnActive: ${String((updateData as any).resetCounterOnActive)}`,
      );
    }

    const [script] = await db
      .update(events)
      .set(updateData)
      .where(eq(events.id, id))
      .returning();

    if (!script) {
      throw new Error("Failed to update script - script not found");
    }
    return script;
  }

  async deleteScript(id: number): Promise<void> {
    try {
      console.log(`Starting deletion of script ${id}`);

      // Delete related resources in proper order to avoid foreign key conflicts

      // 1. Delete environment variables first
      console.log(`Deleting environment variables for script ${id}`);
      await this.deleteEnvVarsByEventId(id);

      // 2. Delete conditional actions that reference this event
      console.log(`Deleting conditional actions for script ${id}`);
      await db
        .delete(conditionalActions)
        .where(eq(conditionalActions.successEventId, id));
      await db
        .delete(conditionalActions)
        .where(eq(conditionalActions.failEventId, id));
      await db
        .delete(conditionalActions)
        .where(eq(conditionalActions.targetEventId, id));

      // 3. Delete logs
      console.log(`Deleting logs for script ${id}`);
      await db.delete(logs).where(eq(logs.eventId, id));

      // 4. Delete workflow execution event associations
      console.log(`Deleting workflow execution events for script ${id}`);
      await db
        .delete(workflowExecutionEvents)
        .where(eq(workflowExecutionEvents.eventId, id));

      // 5. Delete server associations
      console.log(`Deleting event server associations for script ${id}`);
      await db.delete(eventServers).where(eq(eventServers.eventId, id));

      // 6. Delete workflow nodes that reference this script
      console.log(`Deleting workflow nodes for script ${id}`);
      await db.delete(workflowNodes).where(eq(workflowNodes.eventId, id));

      // 7. Delete the script itself last
      console.log(`Deleting script ${id}`);
      await db.delete(events).where(eq(events.id, id));

      console.log(`Successfully deleted script ${id}`);
    } catch (error) {
      console.error(`Error in deleteScript for id ${id}:`, error);
      throw error;
    }
  }

  // Note: Environment variable methods are in the variables module
  // This method is kept here only for the deleteScript dependency
  private async deleteEnvVarsByEventId(eventId: number): Promise<void> {
    await db.delete(envVars).where(eq(envVars.eventId, eventId));
  }

  // Conditional action methods
  async getSuccessActions(eventId: number): Promise<ConditionalAction[]> {
    const eventList = await db
      .select({
        id: conditionalActions.id,
        type: conditionalActions.type,
        value: conditionalActions.value,
        successEventId: conditionalActions.successEventId,
        failEventId: conditionalActions.failEventId,
        alwaysEventId: conditionalActions.alwaysEventId,
        conditionEventId: conditionalActions.conditionEventId,
        targetEventId: conditionalActions.targetEventId,
        toolId: conditionalActions.toolId,
        message: conditionalActions.message,
        emailAddresses: conditionalActions.emailAddresses,
        emailSubject: conditionalActions.emailSubject,
        createdAt: conditionalActions.createdAt,
        updatedAt: conditionalActions.updatedAt,
        targetEventName: events.name,
      })
      .from(conditionalActions)
      .leftJoin(events, eq(conditionalActions.targetEventId, events.id))
      .where(eq(conditionalActions.successEventId, eventId));

    return eventList;
  }

  async getFailActions(eventId: number): Promise<ConditionalAction[]> {
    const eventList = await db
      .select({
        id: conditionalActions.id,
        type: conditionalActions.type,
        value: conditionalActions.value,
        successEventId: conditionalActions.successEventId,
        failEventId: conditionalActions.failEventId,
        alwaysEventId: conditionalActions.alwaysEventId,
        conditionEventId: conditionalActions.conditionEventId,
        targetEventId: conditionalActions.targetEventId,
        toolId: conditionalActions.toolId,
        message: conditionalActions.message,
        emailAddresses: conditionalActions.emailAddresses,
        emailSubject: conditionalActions.emailSubject,
        createdAt: conditionalActions.createdAt,
        updatedAt: conditionalActions.updatedAt,
        targetEventName: events.name,
      })
      .from(conditionalActions)
      .leftJoin(events, eq(conditionalActions.targetEventId, events.id))
      .where(eq(conditionalActions.failEventId, eventId));

    return eventList;
  }

  async getAlwaysActions(eventId: number): Promise<ConditionalAction[]> {
    const eventList = await db
      .select({
        id: conditionalActions.id,
        type: conditionalActions.type,
        value: conditionalActions.value,
        successEventId: conditionalActions.successEventId,
        failEventId: conditionalActions.failEventId,
        alwaysEventId: conditionalActions.alwaysEventId,
        conditionEventId: conditionalActions.conditionEventId,
        targetEventId: conditionalActions.targetEventId,
        toolId: conditionalActions.toolId,
        message: conditionalActions.message,
        emailAddresses: conditionalActions.emailAddresses,
        emailSubject: conditionalActions.emailSubject,
        createdAt: conditionalActions.createdAt,
        updatedAt: conditionalActions.updatedAt,
        targetEventName: events.name,
      })
      .from(conditionalActions)
      .leftJoin(events, eq(conditionalActions.targetEventId, events.id))
      .where(eq(conditionalActions.alwaysEventId, eventId));

    return eventList;
  }

  async getConditionActions(eventId: number): Promise<ConditionalAction[]> {
    const eventList = await db
      .select({
        id: conditionalActions.id,
        type: conditionalActions.type,
        value: conditionalActions.value,
        successEventId: conditionalActions.successEventId,
        failEventId: conditionalActions.failEventId,
        alwaysEventId: conditionalActions.alwaysEventId,
        conditionEventId: conditionalActions.conditionEventId,
        targetEventId: conditionalActions.targetEventId,
        toolId: conditionalActions.toolId,
        message: conditionalActions.message,
        emailAddresses: conditionalActions.emailAddresses,
        emailSubject: conditionalActions.emailSubject,
        createdAt: conditionalActions.createdAt,
        updatedAt: conditionalActions.updatedAt,
        targetEventName: events.name,
      })
      .from(conditionalActions)
      .leftJoin(events, eq(conditionalActions.targetEventId, events.id))
      .where(eq(conditionalActions.conditionEventId, eventId));

    return eventList;
  }

  async createAction(
    insertAction: InsertConditionalAction,
  ): Promise<ConditionalAction> {
    const [event] = await db
      .insert(conditionalActions)
      .values(insertAction)
      .returning();

    if (!event) {
      throw new Error("Failed to create conditional event");
    }

    return event;
  }

  async deleteActionsByEventId(eventId: number): Promise<void> {
    // Delete events where this script is the target
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.successEventId, eventId));
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.failEventId, eventId));
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.alwaysEventId, eventId));
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.targetEventId, eventId));
  }

  async deleteSuccessEventsByScriptId(eventId: number): Promise<void> {
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.successEventId, eventId));
  }

  async deleteFailEventsByScriptId(eventId: number): Promise<void> {
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.failEventId, eventId));
  }

  async deleteAlwaysEventsByScriptId(eventId: number): Promise<void> {
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.alwaysEventId, eventId));
  }

  async deleteConditionEventsByScriptId(eventId: number): Promise<void> {
    await db
      .delete(conditionalActions)
      .where(eq(conditionalActions.conditionEventId, eventId));
  }

  async getConditionalActionsByEventId(
    eventId: number,
  ): Promise<ConditionalAction[]> {
    const actions = await db
      .select()
      .from(conditionalActions)
      .where(
        or(
          eq(conditionalActions.successEventId, eventId),
          eq(conditionalActions.failEventId, eventId),
          eq(conditionalActions.alwaysEventId, eventId),
          eq(conditionalActions.conditionEventId, eventId),
        ),
      );
    return actions;
  }
}
