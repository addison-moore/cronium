// Main storage module that aggregates all storage operations
import type { IStorage } from "./types";

// Import all module classes
import { SystemStorage } from "./modules/system";
import { AuthStorage } from "./modules/auth";
import { VariablesStorage } from "./modules/variables";
import { WebhookStorage } from "./modules/webhooks";
import { ServerStorage } from "./modules/servers";
import { LogStorage } from "./modules/logs";
import { UserStorage } from "./modules/users";
import { WorkflowStorage } from "./modules/workflows";
import { WorkflowNodeStorage } from "./modules/workflow-nodes";
import { WorkflowExecutionStorage } from "./modules/workflow-execution";
import { EventStorage } from "./modules/events";

// Re-export types for backward compatibility
export * from "./types";

/**
 * Main database storage class that implements IStorage interface
 * Delegates to specialized modules for each domain
 */
class DatabaseStorage implements IStorage {
  private system: SystemStorage;
  private auth: AuthStorage;
  private variables: VariablesStorage;
  private webhooks: WebhookStorage;
  public servers: ServerStorage;
  private logs: LogStorage;
  private users: UserStorage;
  private workflows: WorkflowStorage;
  private workflowNodes: WorkflowNodeStorage;
  private workflowExecution: WorkflowExecutionStorage;
  private events: EventStorage;

  constructor() {
    // Initialize all storage modules
    this.system = new SystemStorage();
    this.auth = new AuthStorage();
    this.variables = new VariablesStorage();
    this.webhooks = new WebhookStorage();
    this.servers = new ServerStorage();
    this.logs = new LogStorage();
    this.users = new UserStorage();
    this.workflows = new WorkflowStorage();
    this.workflowNodes = new WorkflowNodeStorage();
    this.workflowExecution = new WorkflowExecutionStorage();
    this.events = new EventStorage();
  }

  // User methods - delegate to users module
  getUser = (id: string) => this.users.getUser(id);
  getUserByEmail = (email: string) => this.users.getUserByEmail(email);
  getUserByUsername = (username: string) =>
    this.users.getUserByUsername(username);
  getUserByInviteToken = (token: string) =>
    this.users.getUserByInviteToken(token);
  getAllUsers = () => this.users.getAllUsers();
  getFirstAdminUser = () => this.users.getFirstAdminUser();
  createUser = (userData: Parameters<IStorage["createUser"]>[0]) =>
    this.users.createUser(userData);
  updateUser = (
    id: string,
    updateData: Parameters<IStorage["updateUser"]>[1],
  ) => this.users.updateUser(id, updateData);
  upsertUser = (userData: Parameters<IStorage["upsertUser"]>[0]) =>
    this.users.upsertUser(userData);
  disableUser = (id: string) => this.users.disableUser(id);
  deleteUser = (id: string) => this.users.deleteUser(id);

  // Event/Script methods - delegate to events module
  getEvent = (id: number) => this.events.getEvent(id);
  getEventWithRelations = (id: number) => this.events.getEventWithRelations(id);
  getActiveEventsWithRelations = () =>
    this.events.getActiveEventsWithRelations();
  getAllEvents = (userId: string) => this.events.getAllEvents(userId);
  getEventsByServerId = (serverId: number, userId: string) =>
    this.events.getEventsByServerId(serverId, userId);
  canViewEvent = (eventId: number, userId: string) =>
    this.events.canViewEvent(eventId, userId);
  canEditEvent = (eventId: number, userId: string) =>
    this.events.canEditEvent(eventId, userId);
  createScript = (insertScript: Parameters<IStorage["createScript"]>[0]) =>
    this.events.createScript(insertScript);
  updateScript = (
    id: number,
    updateData: Parameters<IStorage["updateScript"]>[1],
  ) => this.events.updateScript(id, updateData);
  deleteScript = (id: number) => this.events.deleteScript(id);

  // Environment variable methods - delegate to variables module
  getEnvVars = (eventId: number) => this.variables.getEnvVars(eventId);
  createEnvVar = (insertEnvVar: Parameters<IStorage["createEnvVar"]>[0]) =>
    this.variables.createEnvVar(insertEnvVar);
  deleteEnvVarsByEventId = (eventId: number) =>
    this.variables.deleteEnvVarsByEventId(eventId);

  // Conditional action methods - delegate to events module
  getSuccessActions = (eventId: number) =>
    this.events.getSuccessActions(eventId);
  getFailActions = (eventId: number) => this.events.getFailActions(eventId);
  getAlwaysActions = (eventId: number) => this.events.getAlwaysActions(eventId);
  getConditionActions = (eventId: number) =>
    this.events.getConditionActions(eventId);
  createAction = (insertAction: Parameters<IStorage["createAction"]>[0]) =>
    this.events.createAction(insertAction);
  deleteActionsByEventId = (eventId: number) =>
    this.events.deleteActionsByEventId(eventId);
  deleteSuccessEventsByScriptId = (eventId: number) =>
    this.events.deleteSuccessEventsByScriptId(eventId);
  deleteFailEventsByScriptId = (eventId: number) =>
    this.events.deleteFailEventsByScriptId(eventId);
  deleteAlwaysEventsByScriptId = (eventId: number) =>
    this.events.deleteAlwaysEventsByScriptId(eventId);
  deleteConditionEventsByScriptId = (eventId: number) =>
    this.events.deleteConditionEventsByScriptId(eventId);
  getConditionalActionsByEventId = (eventId: number) =>
    this.events.getConditionalActionsByEventId(eventId);

  // Log methods - delegate to logs module
  getLog = (id: number) => this.logs.getLog(id);
  getLatestLogForScript = (eventId: number) =>
    this.logs.getLatestLogForScript(eventId);
  getAllLogs = (limit?: number, page?: number) =>
    this.logs.getAllLogs(limit, page);
  getLogs = (eventId: number, limit?: number, page?: number) =>
    this.logs.getLogs(eventId, limit, page);
  getLogsByEventId = (
    eventId: number,
    options?: Parameters<IStorage["getLogsByEventId"]>[1],
  ) => this.logs.getLogsByEventId(eventId, options);
  getFilteredLogs = (
    filters: Parameters<IStorage["getFilteredLogs"]>[0],
    limit?: number,
    page?: number,
  ) => this.logs.getFilteredLogs(filters, limit, page);
  getDistinctWorkflowsFromLogs = (userId: string) =>
    this.logs.getDistinctWorkflowsFromLogs(userId);
  createLog = (insertLog: Parameters<IStorage["createLog"]>[0]) =>
    this.logs.createLog(insertLog);
  updateLog = (id: number, updateData: Parameters<IStorage["updateLog"]>[1]) =>
    this.logs.updateLog(id, updateData);
  deleteLog = (id: number) => this.logs.deleteLog(id);

  // Server methods - delegate to servers module
  getServer = (id: number) => this.servers.getServer(id);
  getAllServers = (userId: string, includeArchived = false) =>
    this.servers.getAllServers(userId, includeArchived);
  getArchivedServers = (userId: string) =>
    this.servers.getArchivedServers(userId);
  canUserAccessServer = (serverId: number, userId: string) =>
    this.servers.canUserAccessServer(serverId, userId);
  createServer = (insertServer: Parameters<IStorage["createServer"]>[0]) =>
    this.servers.createServer(insertServer);
  updateServer = (
    id: number,
    updateData: Parameters<IStorage["updateServer"]>[1],
  ) => this.servers.updateServer(id, updateData);
  updateServerStatus = (id: number, online: boolean, lastChecked: Date) =>
    this.servers.updateServerStatus(id, online, lastChecked);
  getServerDeletionImpact = (id: number) =>
    this.servers.getServerDeletionImpact(id);
  archiveServer = (id: number, userId: string, reason?: string) =>
    this.servers.archiveServer(id, userId, reason);
  restoreServer = (id: number) => this.servers.restoreServer(id);
  permanentlyDeleteServer = (id: number) =>
    this.servers.permanentlyDeleteServer(id);
  deleteServer = (id: number) => this.servers.deleteServer(id);

  // Event-Server relationship methods - delegate to servers module
  getEventServers = (eventId: number) => this.servers.getEventServers(eventId);
  addEventServer = (eventId: number, serverId: number) =>
    this.servers.addEventServer(eventId, serverId);
  removeEventServer = (eventId: number, serverId: number) =>
    this.servers.removeEventServer(eventId, serverId);
  setEventServers = (eventId: number, serverIds: number[]) =>
    this.servers.setEventServers(eventId, serverIds);

  // Settings methods - delegate to system module
  getSetting = (key: string) => this.system.getSetting(key);
  getAllSettings = () => this.system.getAllSettings();
  upsertSetting = (key: string, value: string) =>
    this.system.upsertSetting(key, value);

  // API Token methods - delegate to auth module
  getApiToken = (id: number) => this.auth.getApiToken(id);
  getApiTokenByToken = (token: string) => this.auth.getApiTokenByToken(token);
  getUserApiTokens = (userId: string) => this.auth.getUserApiTokens(userId);
  createApiToken = (insertToken: Parameters<IStorage["createApiToken"]>[0]) =>
    this.auth.createApiToken(insertToken);
  updateApiToken = (
    id: number,
    updateData: Parameters<IStorage["updateApiToken"]>[1],
  ) => this.auth.updateApiToken(id, updateData);
  deleteApiToken = (id: number) => this.auth.deleteApiToken(id);
  revokeApiToken = (id: number) => this.auth.revokeApiToken(id);

  // Dashboard stats - delegate to system module
  getDashboardStats = (userId: string) => this.system.getDashboardStats(userId);

  // Workflow methods - delegate to workflows module
  getWorkflow = (id: number) => this.workflows.getWorkflow(id);
  getWorkflowWithRelations = (id: number) =>
    this.workflows.getWorkflowWithRelations(id);
  getAllWorkflows = (userId: string) => this.workflows.getAllWorkflows(userId);
  getWorkflowsUsingEvent = (eventId: number, userId: string) =>
    this.workflows.getWorkflowsUsingEvent(eventId, userId);
  createWorkflow = (
    insertWorkflow: Parameters<IStorage["createWorkflow"]>[0],
  ) => this.workflows.createWorkflow(insertWorkflow);
  updateWorkflow = (
    id: number,
    updateData: Parameters<IStorage["updateWorkflow"]>[1],
  ) => this.workflows.updateWorkflow(id, updateData);
  deleteWorkflow = (id: number) => this.workflows.deleteWorkflow(id);

  // Workflow node methods - delegate to workflowNodes module
  getWorkflowNode = (id: number) => this.workflowNodes.getWorkflowNode(id);
  getWorkflowNodes = (workflowId: number) =>
    this.workflowNodes.getWorkflowNodes(workflowId);
  createWorkflowNode = (
    insertNode: Parameters<IStorage["createWorkflowNode"]>[0],
  ) => this.workflowNodes.createWorkflowNode(insertNode);
  updateWorkflowNode = (
    id: number,
    updateData: Parameters<IStorage["updateWorkflowNode"]>[1],
  ) => this.workflowNodes.updateWorkflowNode(id, updateData);
  deleteWorkflowNode = (id: number) =>
    this.workflowNodes.deleteWorkflowNode(id);

  // Workflow connection methods - delegate to workflowNodes module
  getWorkflowConnection = (id: number) =>
    this.workflowNodes.getWorkflowConnection(id);
  getWorkflowConnections = (workflowId: number) =>
    this.workflowNodes.getWorkflowConnections(workflowId);
  createWorkflowConnection = (
    insertConnection: Parameters<IStorage["createWorkflowConnection"]>[0],
  ) => this.workflowNodes.createWorkflowConnection(insertConnection);
  updateWorkflowConnection = (
    id: number,
    updateData: Parameters<IStorage["updateWorkflowConnection"]>[1],
  ) => this.workflowNodes.updateWorkflowConnection(id, updateData);
  deleteWorkflowConnection = (id: number) =>
    this.workflowNodes.deleteWorkflowConnection(id);

  // Workflow log methods - delegate to workflowExecution module
  getWorkflowLog = (id: number) => this.workflowExecution.getWorkflowLog(id);
  getWorkflowLogs = (workflowId: number, limit?: number, page?: number) =>
    this.workflowExecution.getWorkflowLogs(workflowId, limit, page);
  createWorkflowLog = (
    insertLog: Parameters<IStorage["createWorkflowLog"]>[0],
  ) => this.workflowExecution.createWorkflowLog(insertLog);
  updateWorkflowLog = (
    id: number,
    updateData: Parameters<IStorage["updateWorkflowLog"]>[1],
  ) => this.workflowExecution.updateWorkflowLog(id, updateData);

  // Workflow execution methods - delegate to workflowExecution module
  getWorkflowExecution = (id: number) =>
    this.workflowExecution.getWorkflowExecution(id);
  getWorkflowExecutions = (workflowId: number, limit?: number, page?: number) =>
    this.workflowExecution.getWorkflowExecutions(workflowId, limit, page);
  getAllWorkflowExecutions = (userId: string, limit?: number, page?: number) =>
    this.workflowExecution.getAllWorkflowExecutions(userId, limit, page);
  createWorkflowExecution = (
    insertExecution: Parameters<IStorage["createWorkflowExecution"]>[0],
  ) => this.workflowExecution.createWorkflowExecution(insertExecution);
  updateWorkflowExecution = (
    id: number,
    updateData: Parameters<IStorage["updateWorkflowExecution"]>[1],
  ) => this.workflowExecution.updateWorkflowExecution(id, updateData);

  // Workflow execution event methods - delegate to workflowExecution module
  createWorkflowExecutionEvent = (
    insertEvent: Parameters<IStorage["createWorkflowExecutionEvent"]>[0],
  ) => this.workflowExecution.createWorkflowExecutionEvent(insertEvent);
  getWorkflowExecutionEvents = (executionId: number) =>
    this.workflowExecution.getWorkflowExecutionEvents(executionId);
  updateWorkflowExecutionEvent = (
    id: number,
    updateData: Parameters<IStorage["updateWorkflowExecutionEvent"]>[1],
  ) => this.workflowExecution.updateWorkflowExecutionEvent(id, updateData);
  getUserWorkflowExecutions = (userId: string, limit?: number) =>
    this.workflowExecution.getUserWorkflowExecutions(userId, limit);

  // User variables methods - delegate to variables module
  getUserVariable = (userId: string, key: string) =>
    this.variables.getUserVariable(userId, key);
  setUserVariable = (
    userId: string,
    key: string,
    value: string,
    description?: string,
  ) => this.variables.setUserVariable(userId, key, value, description);
  getUserVariables = (userId: string) =>
    this.variables.getUserVariables(userId);
  createUserVariable = (
    insertVariable: Parameters<IStorage["createUserVariable"]>[0],
  ) => this.variables.createUserVariable(insertVariable);
  updateUserVariable = (
    id: number,
    userId: string,
    updateData: Parameters<IStorage["updateUserVariable"]>[2],
  ) => this.variables.updateUserVariable(id, userId, updateData);
  deleteUserVariable = (id: number, userId: string) =>
    this.variables.deleteUserVariable(id, userId);
  deleteUserVariableByKey = (userId: string, key: string) =>
    this.variables.deleteUserVariableByKey(userId, key);

  // Password Reset Token methods - delegate to auth module
  createPasswordResetToken = (
    insertToken: Parameters<IStorage["createPasswordResetToken"]>[0],
  ) => this.auth.createPasswordResetToken(insertToken);
  getPasswordResetToken = (token: string) =>
    this.auth.getPasswordResetToken(token);
  markPasswordResetTokenAsUsed = (token: string) =>
    this.auth.markPasswordResetTokenAsUsed(token);
  deleteExpiredPasswordResetTokens = () =>
    this.auth.deleteExpiredPasswordResetTokens();

  // Webhook methods - delegate to webhooks module
  getActiveWebhooksForEvent = (event: string) =>
    this.webhooks.getActiveWebhooksForEvent(event);
  getWebhookDeliveryWithRelations = (deliveryId: string) =>
    this.webhooks.getWebhookDeliveryWithRelations(deliveryId);
  getUserWebhooksWithStats = (userId: string) =>
    this.webhooks.getUserWebhooksWithStats(userId);
}

// Create and export singleton instance for backward compatibility
export const storage: IStorage & { servers: ServerStorage } =
  new DatabaseStorage();
