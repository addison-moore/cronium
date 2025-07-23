// Re-export all types from schema
export type {
  User,
  InsertUser,
  EnvVar,
  InsertEnvVar,
  Log,
  InsertLog,
  ConditionalAction,
  InsertConditionalAction,
  Server,
  InsertServer,
  Setting,
  ApiToken,
  InsertApiToken,
  PasswordResetToken,
  InsertPasswordResetToken,
  Workflow,
  InsertWorkflow,
  WorkflowNode,
  InsertWorkflowNode,
  WorkflowConnection,
  InsertWorkflowConnection,
  WorkflowLog,
  InsertWorkflowLog,
  WorkflowExecution,
  InsertWorkflowExecution,
  WorkflowExecutionEvent,
  InsertWorkflowExecutionEvent,
  EventServer,
  UserVariable,
  InsertUserVariable,
  Event,
  InsertEvent,
  LogStatus,
} from "../../shared/schema";

// Import types needed for internal use
import type {
  User,
  InsertUser,
  EnvVar,
  InsertEnvVar,
  Log,
  InsertLog,
  LogStatus,
  ConditionalAction,
  InsertConditionalAction,
  Server,
  InsertServer,
  Workflow,
  InsertWorkflow,
  WorkflowNode,
  InsertWorkflowNode,
  WorkflowConnection,
  InsertWorkflowConnection,
  WorkflowLog,
  InsertWorkflowLog,
  WorkflowExecution,
  InsertWorkflowExecution,
  WorkflowExecutionEvent,
  InsertWorkflowExecutionEvent,
  Event,
  InsertEvent,
  EventServer,
  UserVariable,
  InsertUserVariable,
  ApiToken,
  InsertApiToken,
  Setting,
  PasswordResetToken,
  InsertPasswordResetToken,
  webhooks,
  webhookDeliveries,
  webhookEvents,
} from "../../shared/schema";

// Type alias for backward compatibility
export type Script = Event;

// Type definitions for complex return types
export interface EventWithRelations extends Script {
  envVars: EnvVar[];
  server?: Server | null;
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

// Main storage interface
export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getFirstAdminUser(): Promise<User | null>;
  createUser(
    userData: InsertUser & { skipPasswordHashing?: boolean },
  ): Promise<User>;
  updateUser(id: string, updateData: Partial<InsertUser>): Promise<User>;
  upsertUser(userData: InsertUser): Promise<User>;
  disableUser(id: string): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Script methods
  getEvent(id: number): Promise<Event | undefined>;
  getEventWithRelations(id: number): Promise<EventWithRelations | undefined>;
  getActiveEventsWithRelations(): Promise<EventWithRelations[]>;
  getAllEvents(userId: string): Promise<Event[]>;
  getEventsByServerId(serverId: number, userId: string): Promise<Event[]>;
  canViewEvent(eventId: number, userId: string): Promise<boolean>;
  canEditEvent(eventId: number, userId: string): Promise<boolean>;
  createScript(insertScript: InsertEvent): Promise<Event>;
  updateScript(id: number, updateData: Partial<InsertEvent>): Promise<Event>;
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
  getConditionalActionsByEventId(eventId: number): Promise<ConditionalAction[]>;

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
  getUserWorkflowExecutions(
    userId: string,
    limit?: number,
  ): Promise<WorkflowExecution[]>;

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

  // Webhook methods
  getActiveWebhooksForEvent(
    event: string,
  ): Promise<(typeof webhooks.$inferSelect)[]>;
  getWebhookDeliveryWithRelations(deliveryId: string): Promise<{
    delivery: typeof webhookDeliveries.$inferSelect;
    webhook: typeof webhooks.$inferSelect;
    event: typeof webhookEvents.$inferSelect;
  } | null>;
  getUserWebhooksWithStats(userId: string): Promise<
    Array<{
      webhook: typeof webhooks.$inferSelect;
      totalDeliveries: number;
      successfulDeliveries: number;
      failedDeliveries: number;
    }>
  >;
}
