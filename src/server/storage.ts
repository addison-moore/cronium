import {
  users,
  events,
  envVars,
  logs,
  servers,
  conditionalActions,
  systemSettings,
  apiTokens,
  passwordResetTokens,
  workflows,
  workflowNodes,
  workflowConnections,
  workflowLogs,
  workflowExecutions,
  workflowExecutionEvents,
  eventServers,
  userVariables,
  type User,
  type InsertUser,
  type EnvVar,
  type InsertEnvVar,
  type Log,
  type InsertLog,
  type ConditionalAction,
  type InsertConditionalAction,
  type Server,
  type InsertServer,
  type Setting,
  type ApiToken,
  type InsertApiToken,
  type PasswordResetToken,
  type InsertPasswordResetToken,
  type Workflow,
  type InsertWorkflow,
  type WorkflowNode,
  type InsertWorkflowNode,
  type WorkflowConnection,
  type InsertWorkflowConnection,
  type WorkflowLog,
  type InsertWorkflowLog,
  type WorkflowExecution,
  type InsertWorkflowExecution,
  type WorkflowExecutionEvent,
  type InsertWorkflowExecutionEvent,
  type EventServer,
  type UserVariable,
  type InsertUserVariable,
  type Script,
  type InsertScript, // For backwards compatibility
  RunLocation,
  UserStatus,
  TokenStatus,
  LogStatus,
} from "../shared/schema";
import { db } from "./db";
import {
  eq,
  and,
  desc,
  asc,
  sql,
  count,
  gte,
  lte,
  lt,
  or,
  inArray,
} from "drizzle-orm";
import {
  encryptSensitiveData,
  decryptSensitiveData,
  encryptionService,
} from "../lib/encryption-service";

// Type definitions for complex return types
export interface EventWithRelations extends Script {
  envVars: EnvVar[];
  server?: Server;
  servers: Server[];
  successEvents: ConditionalAction[];
  failEvents: ConditionalAction[];
  alwaysEvents: ConditionalAction[];
  conditionEvents: ConditionalAction[];
}

export interface WorkflowNodeWithEvent extends WorkflowNode {
  event?: EventWithRelations | undefined;
}

export interface WorkflowWithRelations extends Workflow {
  nodes: WorkflowNodeWithEvent[];
  connections: WorkflowConnection[];
}

export interface DashboardStats {
  counts: {
    scripts: number;
    servers: number;
    workflows: number;
  };
  executions: {
    total: number;
    success: number;
    failure: number;
    recent: Log[];
  };
}

export interface LogFilters {
  eventId?: string;
  status?: LogStatus;
  date?: string;
  workflowId?: number | null;
  userId?: string;
  ownEventsOnly?: boolean;
  sharedOnly?: boolean;
}

export interface WorkflowExecutionEventWithDetails
  extends WorkflowExecutionEvent {
  eventName: string | null;
  eventType: string | null;
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(
    userData: InsertUser & { skipPasswordHashing?: boolean },
  ): Promise<User>;
  updateUser(id: string, updateData: Partial<InsertUser>): Promise<User>;
  upsertUser(userData: InsertUser): Promise<User>;
  disableUser(id: string): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Script methods
  getEvent(id: number): Promise<Script | undefined>;
  getEventWithRelations(id: number): Promise<EventWithRelations | undefined>;
  getAllEvents(userId: string): Promise<Script[]>;
  getEventsByServerId(serverId: number, userId: string): Promise<Script[]>;
  canViewEvent(eventId: number, userId: string): Promise<boolean>;
  canEditEvent(eventId: number, userId: string): Promise<boolean>;
  createScript(insertScript: InsertScript): Promise<Script>;
  updateScript(id: number, updateData: Partial<InsertScript>): Promise<Script>;
  deleteScript(id: number): Promise<void>;

  // Environment variable methods
  getEnvVars(eventId: number): Promise<EnvVar[]>;
  createEnvVar(insertEnvVar: InsertEnvVar): Promise<EnvVar>;
  deleteEnvVarsByEventId(eventId: number): Promise<void>;

  // Event methods
  getSuccessActions(eventId: number): Promise<ConditionalAction[]>;
  getFailActions(eventId: number): Promise<ConditionalAction[]>;
  getAlwaysActions(eventId: number): Promise<ConditionalAction[]>;
  getConditionActions(eventId: number): Promise<ConditionalAction[]>;
  createAction(
    insertAction: InsertConditionalAction,
  ): Promise<ConditionalAction>;
  deleteActionsByEventId(eventId: number): Promise<void>;
  deleteSuccessEventsByScriptId(eventId: number): Promise<void>;
  deleteFailEventsByScriptId(eventId: number): Promise<void>;
  deleteAlwaysEventsByScriptId(eventId: number): Promise<void>;
  deleteConditionEventsByScriptId(eventId: number): Promise<void>;
  deleteConditionEventsByScriptId(eventId: number): Promise<void>;
  deleteConditionEventsByScriptId(eventId: number): Promise<void>;

  // Log methods
  getLog(id: number): Promise<Log | undefined>;
  getLatestLogForScript(eventId: number): Promise<Log | undefined>;
  getAllLogs(
    limit?: number,
    page?: number,
  ): Promise<{ logs: Log[]; total: number }>;
  getLogs(
    eventId: number,
    limit?: number,
    page?: number,
  ): Promise<{ logs: Log[]; total: number }>;
  getLogsByEventId(
    eventId: number,
    options?: { limit?: number; offset?: number },
  ): Promise<{ logs: Log[]; total: number }>;
  getFilteredLogs(
    filters: LogFilters,
    limit?: number,
    page?: number,
  ): Promise<{ logs: Log[]; total: number }>;
  getDistinctWorkflowsFromLogs(
    userId: string,
  ): Promise<{ id: number; name: string }[]>;
  createLog(insertLog: InsertLog): Promise<Log>;
  updateLog(id: number, updateData: Partial<InsertLog>): Promise<Log>;
  deleteLog(id: number): Promise<void>;

  // Server methods
  getServer(id: number): Promise<Server | undefined>;
  getAllServers(userId: string): Promise<Server[]>;
  canUserAccessServer(serverId: number, userId: string): Promise<boolean>;
  createServer(insertServer: InsertServer): Promise<Server>;
  updateServer(id: number, updateData: Partial<InsertServer>): Promise<Server>;
  updateServerStatus(
    id: number,
    online: boolean,
    lastChecked: Date,
  ): Promise<Server>;
  deleteServer(id: number): Promise<void>;

  // Event-Server relationship methods
  getEventServers(eventId: number): Promise<EventServer[]>;
  addEventServer(eventId: number, serverId: number): Promise<EventServer>;
  removeEventServer(eventId: number, serverId: number): Promise<void>;
  setEventServers(eventId: number, serverIds: number[]): Promise<void>;

  // Settings methods
  getSetting(key: string): Promise<Setting | undefined>;
  getAllSettings(): Promise<Setting[]>;
  upsertSetting(key: string, value: string): Promise<Setting>;

  // API Token methods
  getApiToken(id: number): Promise<ApiToken | undefined>;
  getApiTokenByToken(token: string): Promise<ApiToken | undefined>;
  getUserApiTokens(userId: string): Promise<ApiToken[]>;
  createApiToken(insertToken: InsertApiToken): Promise<ApiToken>;
  updateApiToken(
    id: number,
    updateData: Partial<InsertApiToken>,
  ): Promise<ApiToken>;
  deleteApiToken(id: number): Promise<void>;
  revokeApiToken(id: number): Promise<ApiToken>;

  // Dashboard stats
  getDashboardStats(userId: string): Promise<DashboardStats>;

  // Workflow methods
  getWorkflow(id: number): Promise<Workflow | undefined>;
  getWorkflowWithRelations(id: number): Promise<WorkflowWithRelations | null>;
  getAllWorkflows(userId: string): Promise<Workflow[]>;
  getWorkflowsUsingEvent(eventId: number, userId: string): Promise<Workflow[]>;
  createWorkflow(insertWorkflow: InsertWorkflow): Promise<Workflow>;
  updateWorkflow(
    id: number,
    updateData: Partial<InsertWorkflow>,
  ): Promise<Workflow>;
  deleteWorkflow(id: number): Promise<void>;

  // Workflow node methods
  getWorkflowNode(id: number): Promise<WorkflowNode | undefined>;
  getWorkflowNodes(workflowId: number): Promise<WorkflowNode[]>;
  createWorkflowNode(insertNode: InsertWorkflowNode): Promise<WorkflowNode>;
  updateWorkflowNode(
    id: number,
    updateData: Partial<InsertWorkflowNode>,
  ): Promise<WorkflowNode>;
  deleteWorkflowNode(id: number): Promise<void>;

  // Workflow connection methods
  getWorkflowConnection(id: number): Promise<WorkflowConnection | undefined>;
  getWorkflowConnections(workflowId: number): Promise<WorkflowConnection[]>;
  createWorkflowConnection(
    insertConnection: InsertWorkflowConnection,
  ): Promise<WorkflowConnection>;
  updateWorkflowConnection(
    id: number,
    updateData: Partial<InsertWorkflowConnection>,
  ): Promise<WorkflowConnection>;
  deleteWorkflowConnection(id: number): Promise<void>;

  // Workflow log methods
  getWorkflowLog(id: number): Promise<WorkflowLog | undefined>;
  getWorkflowLogs(
    workflowId: number,
    limit?: number,
    page?: number,
  ): Promise<{ logs: WorkflowLog[]; total: number }>;
  createWorkflowLog(insertLog: InsertWorkflowLog): Promise<WorkflowLog>;
  updateWorkflowLog(
    id: number,
    updateData: Partial<InsertWorkflowLog>,
  ): Promise<WorkflowLog>;

  // Workflow execution methods
  getWorkflowExecution(id: number): Promise<WorkflowExecution | undefined>;
  getWorkflowExecutions(
    workflowId: number,
    limit?: number,
    page?: number,
  ): Promise<{ executions: WorkflowExecution[]; total: number }>;
  createWorkflowExecution(
    insertExecution: InsertWorkflowExecution,
  ): Promise<WorkflowExecution>;
  updateWorkflowExecution(
    id: number,
    updateData: Partial<InsertWorkflowExecution>,
  ): Promise<WorkflowExecution>;

  // Workflow execution event methods
  createWorkflowExecutionEvent(
    insertEvent: InsertWorkflowExecutionEvent,
  ): Promise<WorkflowExecutionEvent>;
  getWorkflowExecutionEvents(
    executionId: number,
  ): Promise<WorkflowExecutionEventWithDetails[]>;
  updateWorkflowExecutionEvent(
    id: number,
    updateData: Partial<InsertWorkflowExecutionEvent>,
  ): Promise<WorkflowExecutionEvent>;

  // User variables methods for cronium.getVariable() and cronium.setVariable()
  getUserVariable(
    userId: string,
    key: string,
  ): Promise<UserVariable | undefined>;
  setUserVariable(
    userId: string,
    key: string,
    value: string,
    description?: string,
  ): Promise<UserVariable>;
  getUserVariables(userId: string): Promise<UserVariable[]>;
  createUserVariable(insertVariable: InsertUserVariable): Promise<UserVariable>;
  updateUserVariable(
    id: number,
    userId: string,
    updateData: Partial<InsertUserVariable>,
  ): Promise<UserVariable | null>;
  deleteUserVariable(id: number, userId: string): Promise<boolean>;
  deleteUserVariableByKey(userId: string, key: string): Promise<boolean>;

  // Password Reset Token methods
  createPasswordResetToken(
    insertToken: InsertPasswordResetToken,
  ): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenAsUsed(token: string): Promise<void>;
  deleteExpiredPasswordResetTokens(): Promise<void>;
}

class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async getUserByInviteToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.inviteToken, token));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users).orderBy(users.firstName);
    return allUsers;
  }

  async createUser(
    userData: InsertUser & { skipPasswordHashing?: boolean },
  ): Promise<User> {
    // If we're skipping password hashing, it means the password is already hashed
    // and we shouldn't encrypt it further
    let encryptedData;
    if (userData.skipPasswordHashing) {
      // Skip encryption for password field when it's already hashed
      const { password, ...otherData } = userData;
      encryptedData = {
        ...encryptSensitiveData(otherData, "users"),
        password, // Keep the already-hashed password as-is
      };
    } else {
      // Normal flow: encrypt sensitive data first
      encryptedData = encryptSensitiveData(userData, "users");

      // Hash password if provided and not already hashed
      if (encryptedData.password) {
        // Check if password is already a bcrypt hash
        const isBcryptHash =
          encryptedData.password.startsWith("$2b$") ||
          encryptedData.password.startsWith("$2a$");
        if (!isBcryptHash) {
          encryptedData.password = await encryptionService.hashPassword(
            encryptedData.password,
          );
        }
      }
    }

    const [user] = await db.insert(users).values(encryptedData).returning();
    if (!user) {
      throw new Error("Failed to create user");
    }
    return user;
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to update user - user not found");
    }
    return user;
  }

  async upsertUser(userData: InsertUser): Promise<User> {
    // Try to find the user first
    const existingUser = await this.getUser(userData.id);

    if (existingUser) {
      // Update existing user
      return await this.updateUser(userData.id, userData);
    } else {
      // Create new user
      return await this.createUser(userData);
    }
  }

  async disableUser(id: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ status: UserStatus.DISABLED })
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to disable user - user not found");
    }
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    // First get all the user's scripts
    const userScripts = await this.getAllEvents(id);

    // Delete each script
    for (const script of userScripts) {
      await this.deleteScript(script.id);
    }

    // Delete the user's servers
    const userServers = await this.getAllServers(id);
    for (const server of userServers) {
      await this.deleteServer(server.id);
    }

    // Delete the user's API tokens
    const userTokens = await this.getUserApiTokens(id);
    for (const token of userTokens) {
      await this.deleteApiToken(token.id);
    }

    // Delete the user
    await db.delete(users).where(eq(users.id, id));
  }

  // Script methods (now renamed to events)
  async getEvent(id: number): Promise<Script | undefined> {
    const [script] = await db.select().from(events).where(eq(events.id, id));
    return script ?? undefined;
  }

  // Check if a user has access to view an event (they own it or it's shared)
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

  // Check if a user has permission to edit/delete an event (they must own it)
  async canEditEvent(eventId: number, userId: string): Promise<boolean> {
    const [script] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.userId, userId)));

    return !!script;
  }

  async getEventWithRelations(
    id: number,
  ): Promise<EventWithRelations | undefined> {
    try {
      // Get script
      const script = await this.getEvent(id);
      if (!script) return undefined;

      // Get environment variables
      const scriptEnvVars = await this.getEnvVars(id);

      // Get server if needed (legacy single server support)
      let scriptServer;
      if (script.serverId) {
        try {
          scriptServer = await this.getServer(script.serverId);
        } catch (error) {
          console.error(`Error fetching server ${script.serverId}:`, error);
          // Continue without the server rather than failing completely
          scriptServer = undefined;
        }
      }

      // Get multiple servers through junction table
      const eventServerList = await this.getEventServers(id);
      const servers = [];
      for (const eventServer of eventServerList) {
        try {
          const server = await this.getServer(eventServer.serverId);
          if (server) {
            servers.push(server);
          }
        } catch (error) {
          console.error(
            `Error fetching server ${eventServer.serverId}:`,
            error,
          );
          // Continue without this server rather than failing completely
        }
      }

      // Get success, failure, always, and condition events
      const successEvents = await this.getSuccessActions(id);
      const failEvents = await this.getFailActions(id);
      const alwaysEvents = await this.getAlwaysActions(id);
      const conditionEvents = await this.getConditionActions(id);

      // Combine all data
      return {
        ...script,
        envVars: scriptEnvVars,
        server: scriptServer, // Keep for backward compatibility
        servers, // New multi-server support
        successEvents,
        failEvents,
        alwaysEvents,
        conditionEvents,
      } as EventWithRelations;
    } catch (error) {
      console.error(`Error in getEventWithRelations for event ${id}:`, error);
      throw error;
    }
  }

  async getAllEvents(userId: string): Promise<Script[]> {
    // Get user's own scripts and shared scripts from other users
    const userScripts = await db
      .select()
      .from(events)
      .where(sql`${events.userId} = ${userId} OR ${events.shared} = true`)
      .orderBy(desc(events.updatedAt));

    // Enhance each script with server association data
    const enrichedScripts = await Promise.all(
      userScripts.map(async (script) => {
        // Get event servers associations
        const eventServers = await this.getEventServers(script.id);

        return {
          ...script,
          eventServers: eventServers.map((es) => es.serverId), // Array of server IDs
        };
      }),
    );

    return enrichedScripts;
  }

  async getEventsByServerId(
    serverId: number,
    userId: string,
  ): Promise<Script[]> {
    // Get events that are associated with the specified server
    const eventsForServer = await db
      .select({
        event: events,
      })
      .from(events)
      .innerJoin(eventServers, eq(events.id, eventServers.eventId))
      .where(
        and(
          eq(eventServers.serverId, serverId),
          sql`${events.userId} = ${userId} OR ${events.shared} = true`,
        ),
      )
      .orderBy(desc(events.updatedAt));

    // Extract the events and enhance with server association data
    const enrichedScripts = await Promise.all(
      eventsForServer.map(async (row) => {
        const script = row.event;
        // Get event servers associations
        const eventServers = await this.getEventServers(script.id);

        return {
          ...script,
          eventServers: eventServers.map((es) => es.serverId), // Array of server IDs
        };
      }),
    );

    return enrichedScripts;
  }

  async createScript(insertScript: InsertScript): Promise<Script> {
    const [script] = await db.insert(events).values(insertScript).returning();

    if (!script) {
      throw new Error("Failed to create script");
    }
    return script;
  }

  async updateScript(
    id: number,
    updateData: Partial<InsertScript>,
  ): Promise<Script> {
    // Special handling for boolean values to ensure they are stored correctly
    if ("resetCounterOnActive" in updateData) {
      // Force the value to be a true boolean to prevent PostgreSQL string conversion
      updateData.resetCounterOnActive =
        updateData.resetCounterOnActive === true;
      console.log(
        `In storage layer - resetCounterOnActive: ${updateData.resetCounterOnActive}`,
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

  // Environment variable methods
  async getEnvVars(eventId: number): Promise<EnvVar[]> {
    const vars = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, eventId));

    // Decrypt sensitive environment variable values
    return vars.map((envVar) => {
      try {
        return decryptSensitiveData(envVar, "envVars");
      } catch (error) {
        console.error(`Error decrypting env var for event ${eventId}:`, error);
        // Return env var without decryption rather than failing
        return envVar;
      }
    });
  }

  async createEnvVar(insertEnvVar: InsertEnvVar): Promise<EnvVar> {
    // Encrypt sensitive environment variable data before storing
    const encryptedData = encryptSensitiveData(insertEnvVar, "envVars");

    const [envVar] = await db.insert(envVars).values(encryptedData).returning();

    if (!envVar) {
      throw new Error("Failed to create environment variable");
    }

    // Return decrypted data for immediate use
    return decryptSensitiveData<EnvVar>(envVar, "envVars");
  }

  async deleteEnvVarsByEventId(eventId: number): Promise<void> {
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
    insertEvent: InsertConditionalAction,
  ): Promise<ConditionalAction> {
    const [event] = await db
      .insert(conditionalActions)
      .values(insertEvent)
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

  // Log methods
  async getLog(id: number): Promise<Log | undefined> {
    const [log] = await db.select().from(logs).where(eq(logs.id, id));
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
      scriptType: logs.scriptType,
      retries: logs.retries,
      error: logs.error,
      userId: logs.userId,
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

  // Server methods
  async getServer(id: number): Promise<Server | undefined> {
    const [server] = await db.select().from(servers).where(eq(servers.id, id));
    if (server) {
      try {
        return decryptSensitiveData<Server>(server, "servers");
      } catch (error) {
        console.error(`Error decrypting server ${id} data:`, error);
        // Return server without decryption rather than failing
        return server;
      }
    }
    return server;
  }

  async getAllServers(userId: string): Promise<Server[]> {
    // Get user's own servers and shared servers from other users
    const allUserServers = await db
      .select()
      .from(servers)
      .where(
        or(
          eq(servers.userId, userId), // User's own servers
          eq(servers.shared, true), // Shared servers from other users
        ),
      )
      .orderBy(servers.name);

    // Decrypt sensitive data for all servers
    return allUserServers.map((server) =>
      decryptSensitiveData(server, "servers"),
    );
  }

  async canUserAccessServer(
    serverId: number,
    userId: string,
  ): Promise<boolean> {
    const server = await db
      .select()
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    if (server.length === 0) return false;

    // User can access if they own the server or if it's shared
    return server[0]?.userId === userId || server[0]?.shared === true;
  }

  async createServer(insertServer: InsertServer): Promise<Server> {
    // Encrypt sensitive server data before storing
    const encryptedData = encryptSensitiveData(insertServer, "servers");

    const [server] = await db.insert(servers).values(encryptedData).returning();

    if (!server) {
      throw new Error("Failed to create server");
    }
    // Return decrypted data for immediate use
    return decryptSensitiveData<Server>(server, "servers");
  }

  async updateServer(
    id: number,
    updateData: Partial<InsertServer>,
  ): Promise<Server> {
    // Encrypt sensitive data before updating
    const encryptedData = encryptSensitiveData(updateData, "servers");

    const [server] = await db
      .update(servers)
      .set(encryptedData)
      .where(eq(servers.id, id))
      .returning();

    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    // Return decrypted data for immediate use
    return decryptSensitiveData<Server>(server, "servers");
  }

  async updateServerStatus(
    id: number,
    online: boolean,
    lastChecked: Date,
  ): Promise<Server> {
    const [server] = await db
      .update(servers)
      .set({
        online: online,
        lastChecked: lastChecked,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id))
      .returning();

    if (!server) {
      throw new Error("Failed to update server status - server not found");
    }
    return server;
  }

  async deleteServer(id: number): Promise<void> {
    // First update any scripts that use this server to run locally
    await db
      .update(events)
      .set({
        runLocation: RunLocation.LOCAL,
        serverId: null,
      })
      .where(eq(events.serverId, id));

    // Then delete the server
    await db.delete(servers).where(eq(servers.id, id));
  }

  // Settings methods
  async getSetting(key: string): Promise<Setting | undefined> {
    const [setting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));
    return setting;
  }

  async getAllSettings(): Promise<Setting[]> {
    const allSettings = await db.select().from(systemSettings);
    return allSettings;
  }

  async upsertSetting(key: string, value: string): Promise<Setting> {
    // Check if the setting exists
    const existingSetting = await this.getSetting(key);

    if (existingSetting) {
      // Update the existing setting
      const [setting] = await db
        .update(systemSettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
        .returning();

      if (!setting) {
        throw new Error("Failed to update setting");
      }
      return setting;
    } else {
      // Create a new setting
      const [setting] = await db
        .insert(systemSettings)
        .values({
          key,
          value,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!setting) {
        throw new Error("Failed to create setting");
      }
      return setting;
    }
  }

  // Dashboard stats
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    // Get counts for various entities
    const [scriptCount] = await db
      .select({ count: count() })
      .from(events)
      .where(eq(events.userId, userId));
    const [serverCount] = await db
      .select({ count: count() })
      .from(servers)
      .where(eq(servers.userId, userId));
    const [workflowCount] = await db
      .select({ count: count() })
      .from(workflows)
      .where(eq(workflows.userId, userId));

    // Get recent execution stats
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentLogs = await db
      .select()
      .from(logs)
      .where(
        and(eq(logs.userId, userId), gte(logs.startTime, twentyFourHoursAgo)),
      )
      .orderBy(desc(logs.startTime));

    const successCount = recentLogs.filter((log) => log.successful).length;
    const failureCount = recentLogs.filter(
      (log) => !log.successful && log.status !== LogStatus.RUNNING,
    ).length;

    // Recent logs (last 5)
    const recentLogsList = recentLogs.slice(0, 5);

    return {
      counts: {
        scripts: Number(scriptCount?.count) ?? 0,
        servers: Number(serverCount?.count) ?? 0,
        workflows: Number(workflowCount?.count) ?? 0,
      },
      executions: {
        total: recentLogs.length,
        success: successCount,
        failure: failureCount,
        recent: recentLogsList,
      },
    };
  }

  // Workflow methods
  async getWorkflow(id: number): Promise<Workflow | undefined> {
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, id));
    return workflow;
  }

  async getAllWorkflows(userId: string): Promise<Workflow[]> {
    const userWorkflows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.userId, userId))
      .orderBy(workflows.name);

    return userWorkflows;
  }

  async getWorkflowsUsingEvent(
    eventId: number,
    userId: string,
  ): Promise<Workflow[]> {
    // First get unique workflow IDs that use this event
    const workflowIds = await db
      .selectDistinct({
        workflowId: workflowNodes.workflowId,
      })
      .from(workflowNodes)
      .innerJoin(workflows, eq(workflowNodes.workflowId, workflows.id))
      .where(
        and(eq(workflowNodes.eventId, eventId), eq(workflows.userId, userId)),
      );

    // Then fetch the full workflow details
    if (workflowIds.length === 0) {
      return [];
    }

    const ids = workflowIds.map((w) => w.workflowId);
    const workflowsUsingEvent = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.userId, userId), inArray(workflows.id, ids)))
      .orderBy(workflows.name);

    return workflowsUsingEvent;
  }

  async createWorkflow(insertWorkflow: InsertWorkflow): Promise<Workflow> {
    const [workflow] = await db
      .insert(workflows)
      .values(insertWorkflow)
      .returning();

    if (!workflow) {
      throw new Error("Failed to create workflow");
    }
    return workflow;
  }

  async getWorkflowWithRelations(
    id: number,
  ): Promise<WorkflowWithRelations | null> {
    const workflow = await this.getWorkflow(id);
    if (!workflow) return null;

    const nodes = await this.getWorkflowNodes(id);
    const connections = await this.getWorkflowConnections(id);

    // Get the events for each node
    const nodesWithEvents = await Promise.all(
      nodes.map(async (node): Promise<WorkflowNodeWithEvent> => {
        if (node.eventId) {
          const event = await this.getEventWithRelations(node.eventId);
          return { ...node, event };
        }
        return { ...node, event: undefined };
      }),
    );

    return {
      ...workflow,
      nodes: nodesWithEvents,
      connections,
    };
  }

  async updateWorkflow(
    id: number,
    updateData: Partial<InsertWorkflow>,
  ): Promise<Workflow> {
    const [workflow] = await db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, id))
      .returning();

    if (!workflow) {
      throw new Error("Failed to update workflow - workflow not found");
    }
    return workflow;
  }

  async deleteWorkflow(id: number): Promise<void> {
    // Delete all nodes
    const nodes = await this.getWorkflowNodes(id);
    for (const node of nodes) {
      await this.deleteWorkflowNode(node.id);
    }

    // Delete all connections
    const connections = await this.getWorkflowConnections(id);
    for (const connection of connections) {
      await this.deleteWorkflowConnection(connection.id);
    }

    // Delete logs
    await db.delete(workflowLogs).where(eq(workflowLogs.workflowId, id));

    // Delete the workflow itself
    await db.delete(workflows).where(eq(workflows.id, id));
  }

  // Workflow node methods
  async getWorkflowNode(id: number): Promise<WorkflowNode | undefined> {
    const [node] = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.id, id));
    return node;
  }

  async getWorkflowNodes(workflowId: number): Promise<WorkflowNode[]> {
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    return nodes;
  }

  async createWorkflowNode(
    insertNode: InsertWorkflowNode,
  ): Promise<WorkflowNode> {
    const [node] = await db
      .insert(workflowNodes)
      .values(insertNode)
      .returning();

    if (!node) {
      throw new Error("Failed to create workflow node");
    }
    return node;
  }

  async updateWorkflowNode(
    id: number,
    updateData: Partial<InsertWorkflowNode>,
  ): Promise<WorkflowNode> {
    const [node] = await db
      .update(workflowNodes)
      .set(updateData)
      .where(eq(workflowNodes.id, id))
      .returning();

    if (!node) {
      throw new Error("Failed to update workflow node - node not found");
    }
    return node;
  }

  async deleteWorkflowNode(id: number): Promise<void> {
    // Delete connections that include this node
    await db
      .delete(workflowConnections)
      .where(eq(workflowConnections.sourceNodeId, id));
    await db
      .delete(workflowConnections)
      .where(eq(workflowConnections.targetNodeId, id));

    // Delete the node itself
    await db.delete(workflowNodes).where(eq(workflowNodes.id, id));
  }

  // Workflow connection methods
  async getWorkflowConnection(
    id: number,
  ): Promise<WorkflowConnection | undefined> {
    const [connection] = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.id, id));
    return connection;
  }

  async getWorkflowConnections(
    workflowId: number,
  ): Promise<WorkflowConnection[]> {
    const connections = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.workflowId, workflowId));
    return connections;
  }

  async createWorkflowConnection(
    insertConnection: InsertWorkflowConnection,
  ): Promise<WorkflowConnection> {
    const [connection] = await db
      .insert(workflowConnections)
      .values(insertConnection)
      .returning();

    if (!connection) {
      throw new Error("Failed to create workflow connection");
    }
    return connection;
  }

  async updateWorkflowConnection(
    id: number,
    updateData: Partial<InsertWorkflowConnection>,
  ): Promise<WorkflowConnection> {
    const [connection] = await db
      .update(workflowConnections)
      .set(updateData)
      .where(eq(workflowConnections.id, id))
      .returning();

    if (!connection) {
      throw new Error(
        "Failed to update workflow connection - connection not found",
      );
    }
    return connection;
  }

  async deleteWorkflowConnection(id: number): Promise<void> {
    await db.delete(workflowConnections).where(eq(workflowConnections.id, id));
  }

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
  ): Promise<{ executions: WorkflowExecution[]; total: number }> {
    const offset = (page - 1) * limit;

    const executions = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, workflowId))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, workflowId));

    return {
      executions,
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

  // Event-Server relationship methods
  async getEventServers(eventId: number): Promise<EventServer[]> {
    const eventServerList = await db
      .select()
      .from(eventServers)
      .where(eq(eventServers.eventId, eventId));

    return eventServerList;
  }

  async addEventServer(
    eventId: number,
    serverId: number,
  ): Promise<EventServer> {
    const [eventServer] = await db
      .insert(eventServers)
      .values({ eventId, serverId })
      .returning();

    if (!eventServer) {
      throw new Error("Failed to add event server association");
    }
    return eventServer;
  }

  async removeEventServer(eventId: number, serverId: number): Promise<void> {
    await db
      .delete(eventServers)
      .where(
        and(
          eq(eventServers.eventId, eventId),
          eq(eventServers.serverId, serverId),
        ),
      );
  }

  async setEventServers(eventId: number, serverIds: number[]): Promise<void> {
    // Remove all existing event-server relationships for this event
    await db.delete(eventServers).where(eq(eventServers.eventId, eventId));

    // Add new relationships if serverIds is not empty
    if (serverIds.length > 0) {
      const eventServerData = serverIds.map((serverId) => ({
        eventId,
        serverId,
      }));

      await db.insert(eventServers).values(eventServerData);
    }
  }

  // API Token methods
  async getApiToken(id: number): Promise<ApiToken | undefined> {
    const [token] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, id));
    if (token?.token && typeof token.token === "string") {
      try {
        token.token = encryptionService.decrypt(token.token);
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
      }
    }
    return token;
  }

  async getApiTokenByToken(token: string): Promise<ApiToken | undefined> {
    const allTokens = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.status, TokenStatus.ACTIVE));

    for (const apiToken of allTokens) {
      try {
        if (typeof apiToken.token === "string") {
          const decryptedToken = encryptionService.decrypt(apiToken.token);
          if (decryptedToken === token) {
            return { ...apiToken, token: decryptedToken };
          }
        }
      } catch (error) {
        // Log the error but continue processing other tokens
        console.error(
          `Failed to decrypt API token (ID: ${apiToken.id}):`,
          error instanceof Error ? error.message : "Unknown error",
        );
        continue;
      }
    }

    return undefined;
  }

  async getUserApiTokens(userId: string): Promise<ApiToken[]> {
    const tokens = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));

    return tokens.map((token) => {
      try {
        if (typeof token.token === "string") {
          return { ...token, token: encryptionService.decrypt(token.token) };
        }
        return token;
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
        return token;
      }
    });
  }

  async createApiToken(insertToken: InsertApiToken): Promise<ApiToken> {
    const encryptedToken = {
      ...insertToken,
      token: encryptionService.encrypt(insertToken.token),
    };

    const [token] = await db
      .insert(apiTokens)
      .values(encryptedToken)
      .returning();

    if (!token) {
      throw new Error("Failed to create API token");
    }
    return { ...token, token: insertToken.token };
  }

  async updateApiToken(
    id: number,
    updateData: Partial<InsertApiToken>,
  ): Promise<ApiToken> {
    const updateDataWithEncryption = { ...updateData };

    if (updateData.token) {
      updateDataWithEncryption.token = encryptionService.encrypt(
        updateData.token,
      );
    }

    const [token] = await db
      .update(apiTokens)
      .set({ ...updateDataWithEncryption, updatedAt: new Date() })
      .where(eq(apiTokens.id, id))
      .returning();

    if (!token) {
      throw new Error("Failed to update API token - token not found");
    }
    if (token.token && typeof token.token === "string") {
      try {
        token.token = encryptionService.decrypt(token.token);
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
      }
    }

    return token;
  }

  async deleteApiToken(id: number): Promise<void> {
    await db.delete(apiTokens).where(eq(apiTokens.id, id));
  }

  async revokeApiToken(id: number): Promise<ApiToken> {
    const [token] = await db
      .update(apiTokens)
      .set({
        status: TokenStatus.REVOKED,
        updatedAt: new Date(),
      })
      .where(eq(apiTokens.id, id))
      .returning();

    if (!token) {
      throw new Error("Failed to revoke API token - token not found");
    }
    if (token.token && typeof token.token === "string") {
      try {
        token.token = encryptionService.decrypt(token.token);
      } catch (error) {
        console.warn("Failed to decrypt API token:", error);
      }
    }

    return token;
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

  // User Variables methods for cronium.getVariable() and cronium.setVariable()
  async getUserVariable(
    userId: string,
    key: string,
  ): Promise<UserVariable | undefined> {
    const [variable] = await db
      .select()
      .from(userVariables)
      .where(and(eq(userVariables.userId, userId), eq(userVariables.key, key)));

    return variable ?? undefined;
  }

  async setUserVariable(
    userId: string,
    key: string,
    value: string,
    description?: string,
  ): Promise<UserVariable> {
    // Try to update existing variable first
    const existingVariable = await this.getUserVariable(userId, key);

    if (existingVariable) {
      const [updatedVariable] = await db
        .update(userVariables)
        .set({
          value,
          description: description ?? existingVariable.description,
          updatedAt: new Date(),
        })
        .where(
          and(eq(userVariables.userId, userId), eq(userVariables.key, key)),
        )
        .returning();

      if (!updatedVariable) {
        throw new Error("Failed to update user variable");
      }
      return updatedVariable;
    } else {
      // Create new variable
      const [newVariable] = await db
        .insert(userVariables)
        .values({
          userId,
          key,
          value,
          description,
        })
        .returning();

      if (!newVariable) {
        throw new Error("Failed to create user variable");
      }
      return newVariable;
    }
  }

  async getUserVariables(userId: string): Promise<UserVariable[]> {
    const variables = await db
      .select()
      .from(userVariables)
      .where(eq(userVariables.userId, userId))
      .orderBy(asc(userVariables.key));

    return variables;
  }

  async createUserVariable(
    insertVariable: InsertUserVariable,
  ): Promise<UserVariable> {
    const [variable] = await db
      .insert(userVariables)
      .values(insertVariable)
      .returning();

    if (!variable) {
      throw new Error("Failed to create user variable");
    }
    return variable;
  }

  async updateUserVariable(
    id: number,
    userId: string,
    updateData: Partial<InsertUserVariable>,
  ): Promise<UserVariable | null> {
    const [variable] = await db
      .update(userVariables)
      .set(updateData)
      .where(and(eq(userVariables.id, id), eq(userVariables.userId, userId)))
      .returning();

    return variable ?? null;
  }

  async deleteUserVariable(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(userVariables)
      .where(and(eq(userVariables.id, id), eq(userVariables.userId, userId)));

    return (result.rowCount ?? 0) > 0;
  }

  async deleteUserVariableByKey(userId: string, key: string): Promise<boolean> {
    const result = await db
      .delete(userVariables)
      .where(and(eq(userVariables.userId, userId), eq(userVariables.key, key)));

    return (result.rowCount ?? 0) > 0;
  }

  // Password Reset Token methods
  async createPasswordResetToken(
    insertToken: InsertPasswordResetToken,
  ): Promise<PasswordResetToken> {
    const [token] = await db
      .insert(passwordResetTokens)
      .values(insertToken)
      .returning();

    if (!token) {
      throw new Error("Failed to create password reset token");
    }
    return token;
  }

  async getPasswordResetToken(
    token: string,
  ): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          eq(passwordResetTokens.used, false),
          gte(passwordResetTokens.expiresAt, new Date()),
        ),
      );

    return resetToken;
  }

  async markPasswordResetTokenAsUsed(token: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.token, token));
  }

  async deleteExpiredPasswordResetTokens(): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()));
  }
}

export const storage: IStorage = new DatabaseStorage();
