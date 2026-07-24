import {
  users,
  events,
  envVars,
  logs,
  servers,
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
  webhooks,
  webhookEvents,
  webhookDeliveries,
  serverDeletionNotifications,
  toolActionLogs,
  jobs,
  executions,
  serverGroups,
  serverGroupMembers,
  type ServerGroup,
  type User,
  type InsertUser,
  type EnvVar,
  type InsertEnvVar,
  type Log,
  type InsertLog,
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
  type Event,
  type InsertEvent,
  RunLocation,
  UserStatus,
  TokenStatus,
  LogStatus,
  roles,
} from "../shared/schema";
import { db } from "./db";
import {
  eq,
  and,
  or,
  desc,
  asc,
  sql,
  count,
  gte,
  lte,
  lt,
  inArray,
  ilike,
  like,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  encryptSensitiveData,
  decryptSensitiveData,
  encryptionService,
  isSystemSettingSensitive,
} from "../lib/encryption-service";
import {
  encryptServerSecret,
  decryptServerSecret,
  encryptEnvVarValue,
  decryptEnvVarValue,
  encryptSystemSetting,
  decryptSystemSetting,
  encryptMfaSecret,
  decryptMfaSecret,
} from "@/lib/security/field-secret";
import { hashApiToken, isHashedApiToken } from "../lib/api-token-hash";

/**
 * Record-bound (vault) encryption of a server row's credential columns, with
 * legacy-passthrough decryption (2.1). Bound to the owning tenant so ciphertext
 * cannot be moved between tenants' server rows.
 */
function encryptServerColumns<
  T extends {
    sshKey?: string | null | undefined;
    password?: string | null | undefined;
  },
>(row: T, userId: string): T {
  const out = { ...row };
  if (typeof row.sshKey === "string" && row.sshKey) {
    out.sshKey = encryptServerSecret(row.sshKey, "sshKey", userId);
  }
  if (typeof row.password === "string" && row.password) {
    out.password = encryptServerSecret(row.password, "password", userId);
  }
  return out;
}

function decryptServerRow(server: Server): Server {
  const out = { ...server };
  if (typeof server.sshKey === "string" && server.sshKey) {
    out.sshKey = decryptServerSecret(server.sshKey, "sshKey", server.userId);
  }
  if (typeof server.password === "string" && server.password) {
    out.password = decryptServerSecret(
      server.password,
      "password",
      server.userId,
    );
  }
  return out;
}
import {
  assertSocketSecurityStoreAvailable,
  publishAllSocketRevocation,
  publishUserSocketRevocation,
} from "./socket-security-store";
import { invalidatePrincipal } from "./security/authorization";
import {
  encryptVariableValue,
  decryptVariableValue,
} from "@/lib/security/variable-secret";

/** Return a user-variable row with its value decrypted (or legacy plaintext). */
function decryptVariableRow<
  T extends { userId: string; key: string; value: string },
>(row: T): T {
  return {
    ...row,
    value: decryptVariableValue(row.value, row.userId, row.key),
  };
}
import {
  normalizePagination,
  createPaginatedResult,
  buildSearchConditions,
  buildUserAccessConditions,
} from "./utils/db-patterns";
import type { PaginatedResult } from "./utils/db-patterns";
import type { EventQueryInput } from "../shared/schemas/events";
import type { WorkflowQueryInput } from "../shared/schemas/workflows";
import type { VariableQueryInput } from "../shared/schemas/variables";
import type { ServerQueryInput } from "../shared/schemas/servers";
import type { AdminQueryInput } from "../shared/schemas/admin";

// Re-export types from schema for convenience
export type { WorkflowExecution } from "../shared/schema";

// Role types
export type Role = typeof roles.$inferSelect;
export interface RolePermissions {
  console: boolean;
  localServerAccess: boolean;
}

const SOCKET_SENSITIVE_USER_FIELDS = [
  "password",
  "role",
  "roleId",
  "status",
] as const;
const SOCKET_SENSITIVE_SERVER_FIELDS = [
  "userId",
  "address",
  "sshKey",
  "password",
  "username",
  "port",
  "isArchived",
  "sshKeyPurged",
  "passwordPurged",
] as const;

function changesSocketAuthorization(updateData: Partial<InsertUser>): boolean {
  return SOCKET_SENSITIVE_USER_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(updateData, field),
  );
}

function changesTerminalAuthorization(
  updateData: Partial<InsertServer>,
): boolean {
  return SOCKET_SENSITIVE_SERVER_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(updateData, field),
  );
}

// Type alias for backward compatibility
type Script = Event;

// Type definitions for complex return types
export interface EventWithRelations extends Script {
  envVars: EnvVar[];
  server?: Server | null;
  servers: Server[];
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
  startDate?: string;
  endDate?: string;
  workflowId?: number | null;
  userId?: string;
  ownEventsOnly?: boolean;
  sharedOnly?: boolean;
  // Free-text search over output/error/eventName
  search?: string;
  searchFields?: Array<"output" | "errorOutput" | "eventName">;
  caseSensitive?: boolean;
}

export interface WorkflowExecutionEventWithDetails extends WorkflowExecutionEvent {
  eventName: string | null;
  eventType: string | null;
}

export interface ServerGroupWithServers extends ServerGroup {
  serverIds: number[];
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  queryUsers(query: AdminQueryInput): Promise<PaginatedResult<User>>;
  createUser(
    userData: InsertUser & { skipPasswordHashing?: boolean },
  ): Promise<User>;
  updateUser(id: string, updateData: Partial<InsertUser>): Promise<User>;
  upsertUser(userData: InsertUser): Promise<User>;
  disableUser(id: string): Promise<User>;
  revokeUserSessions(id: string): Promise<User>;
  deleteUser(id: string): Promise<void>;
  getMfaSecret(userId: string): Promise<string | null>;
  setPendingMfaSecret(userId: string, secret: string): Promise<void>;
  enableMfa(userId: string, recoveryCodeHashes: string[]): Promise<void>;
  disableMfa(userId: string): Promise<void>;
  consumeMfaRecoveryCode(userId: string, codeHash: string): Promise<boolean>;
  replaceMfaRecoveryCodes(
    userId: string,
    recoveryCodeHashes: string[],
  ): Promise<void>;

  // Role methods
  listRoles(): Promise<Role[]>;
  getRoleById(id: number): Promise<Role | undefined>;
  getRoleByName(name: string): Promise<Role | undefined>;
  getDefaultRole(): Promise<Role | undefined>;
  updateRolePermissions(
    id: number,
    permissions: RolePermissions,
  ): Promise<Role | undefined>;

  // Script methods
  getEvent(id: number): Promise<Event | undefined>;
  getEventWithRelations(id: number): Promise<EventWithRelations | undefined>;
  getActiveEventsWithRelations(): Promise<EventWithRelations[]>;
  getAllEvents(userId: string): Promise<Event[]>;
  queryEvents(
    userId: string,
    query: EventQueryInput,
  ): Promise<PaginatedResult<Event>>;
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

  // Server group methods
  getServerGroups(userId: string): Promise<ServerGroupWithServers[]>;
  getServerGroup(id: number): Promise<ServerGroupWithServers | undefined>;
  createServerGroup(
    userId: string,
    name: string,
    serverIds: number[],
  ): Promise<ServerGroupWithServers>;
  updateServerGroup(
    id: number,
    name: string,
    serverIds: number[],
  ): Promise<ServerGroupWithServers>;
  deleteServerGroup(id: number): Promise<void>;

  // Server methods
  getServer(id: number): Promise<Server | undefined>;
  getServerForExecution(
    id: number,
    userId: string,
  ): Promise<Server | undefined>;
  getAllServers(userId: string): Promise<Server[]>;
  queryServers(
    userId: string,
    query: ServerQueryInput,
  ): Promise<PaginatedResult<Server>>;
  canUserAccessServer(serverId: number, userId: string): Promise<boolean>;
  createServer(insertServer: InsertServer): Promise<Server>;
  updateServer(id: number, updateData: Partial<InsertServer>): Promise<Server>;
  updateServerStatus(
    id: number,
    online: boolean,
    lastChecked: Date,
  ): Promise<Server>;
  deleteServer(id: number): Promise<void>;
  permanentlyDeleteServer(id: number): Promise<void>;
  getServersScheduledForDeletion(limit?: number): Promise<Server[]>;
  getServersApproachingDeletion(daysAhead: number): Promise<Server[]>;
  hasNotificationBeenSent(
    serverId: number,
    notificationType: string,
  ): Promise<boolean>;
  createDeletionNotification(
    serverId: number,
    userId: string,
    notificationType: string,
  ): Promise<void>;

  // Event-Server relationship methods
  getEventServers(eventId: number): Promise<EventServer[]>;
  addEventServer(
    eventId: number,
    serverId: number,
    userId: string,
  ): Promise<EventServer>;
  removeEventServer(
    eventId: number,
    serverId: number,
    userId: string,
  ): Promise<void>;
  setEventServers(
    eventId: number,
    serverIds: number[],
    userId: string,
  ): Promise<void>;

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
  queryWorkflows(
    userId: string,
    query: WorkflowQueryInput,
  ): Promise<PaginatedResult<Workflow>>;
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
  queryUserVariables(
    userId: string,
    query: VariableQueryInput,
  ): Promise<PaginatedResult<UserVariable>>;
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
  getPasswordResetToken(
    tokenHash: string,
  ): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenAsUsed(tokenHash: string): Promise<void>;
  consumePasswordResetToken(
    tokenHash: string,
  ): Promise<PasswordResetToken | undefined>;
  deleteExpiredPasswordResetTokens(): Promise<void>;

  // Webhook methods
  getActiveWebhooksForEvent(
    event: string,
    ownerUserId: string,
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

  async queryUsers(query: AdminQueryInput): Promise<PaginatedResult<User>> {
    const pagination = normalizePagination(query);
    const conditions: SQL[] = [];

    if (query.role) {
      conditions.push(eq(users.role, query.role));
    }

    if (query.status) {
      conditions.push(eq(users.status, query.status));
    }

    const searchCondition = buildSearchConditions(query.search, [
      users.email,
      users.firstName,
      users.lastName,
      users.username,
    ]);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]!
          : and(...conditions);

    const countRows = whereClause
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(whereClause)
      : await db.select({ count: sql<number>`count(*)` }).from(users);
    const [countResult] = countRows;
    const total = countResult?.count ?? 0;

    const listQuery = whereClause
      ? db.select().from(users).where(whereClause)
      : db.select().from(users);
    const rows = await listQuery
      .orderBy(asc(users.firstName))
      .limit(pagination.limit)
      .offset(pagination.offset);

    return createPaginatedResult(rows, total, pagination);
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
    const revokeSessions = changesSocketAuthorization(updateData);
    if (revokeSessions) await assertSocketSecurityStoreAvailable();

    // Password/role/status changes invalidate every outstanding session and
    // bearer principal: the version bump happens in the same UPDATE statement
    // so there is no window where the new credentials and old sessions coexist.
    const [user] = await db
      .update(users)
      .set(
        revokeSessions
          ? { ...updateData, sessionVersion: sql`${users.sessionVersion} + 1` }
          : updateData,
      )
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to update user - user not found");
    }
    if (revokeSessions) {
      await invalidatePrincipal(id);
      await publishUserSocketRevocation(id, "user authorization changed");
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

  // --- MFA (TOTP) ---

  /** Return the decrypted TOTP secret for a user, or null when MFA is unset. */
  async getMfaSecret(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ mfaSecret: users.mfaSecret })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row?.mfaSecret) return null;
    try {
      return decryptMfaSecret(row.mfaSecret, userId);
    } catch {
      return null;
    }
  }

  /**
   * Persist a pending (not-yet-enabled) TOTP secret, encrypted at rest. Used
   * during enrollment before the user proves possession with a valid code.
   */
  async setPendingMfaSecret(userId: string, secret: string): Promise<void> {
    await db
      .update(users)
      .set({
        mfaSecret: encryptMfaSecret(secret, userId),
        mfaEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  /**
   * Enable MFA and store single-use recovery codes (hashed). Bumps
   * sessionVersion so the security change propagates like other credential
   * changes.
   */
  async enableMfa(userId: string, recoveryCodeHashes: string[]): Promise<void> {
    await db
      .update(users)
      .set({
        mfaEnabled: true,
        mfaRecoveryCodes: recoveryCodeHashes,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await invalidatePrincipal(userId);
  }

  /** Disable MFA and clear all secret material. Bumps sessionVersion. */
  async disableMfa(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await invalidatePrincipal(userId);
  }

  /**
   * Atomically consume one recovery code: succeeds only if `codeHash` is still
   * present, removing it in the same UPDATE so it cannot be reused.
   */
  async consumeMfaRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    const [user] = await db
      .select({ codes: users.mfaRecoveryCodes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const codes = user?.codes ?? [];
    if (!codes.includes(codeHash)) return false;
    const remaining = codes.filter((c) => c !== codeHash);
    const result = await db
      .update(users)
      .set({ mfaRecoveryCodes: remaining, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, userId),
          sql`${users.mfaRecoveryCodes}::jsonb @> ${JSON.stringify([codeHash])}::jsonb`,
        ),
      )
      .returning({ id: users.id });
    return result.length > 0;
  }

  async replaceMfaRecoveryCodes(
    userId: string,
    recoveryCodeHashes: string[],
  ): Promise<void> {
    await db
      .update(users)
      .set({ mfaRecoveryCodes: recoveryCodeHashes, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async disableUser(id: string): Promise<User> {
    await assertSocketSecurityStoreAvailable();
    const [user] = await db
      .update(users)
      .set({
        status: UserStatus.DISABLED,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to disable user - user not found");
    }
    await invalidatePrincipal(id);
    await publishUserSocketRevocation(id, "user disabled");
    return user;
  }

  /**
   * Invalidate every outstanding browser session and bearer principal for a
   * user without changing role/status, and disconnect their live sockets.
   * Used for administrator-requested sign-out-all and account recovery.
   */
  async revokeUserSessions(id: string): Promise<User> {
    await assertSocketSecurityStoreAvailable();
    const [user] = await db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to revoke sessions - user not found");
    }
    await invalidatePrincipal(id);
    await publishUserSocketRevocation(id, "sessions revoked");
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await assertSocketSecurityStoreAvailable();
    // Use batch operations to delete user data efficiently
    // Note: Due to foreign key constraints, we need to delete in the correct order

    // Get all user's event IDs for batch deletion
    const userEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.userId, id));

    const eventIds = userEvents.map((e) => e.id);

    if (eventIds.length > 0) {
      // Delete all related data in batch operations
      // Delete logs
      await db.delete(logs).where(inArray(logs.eventId, eventIds));

      // Delete tool action logs
      await db
        .delete(toolActionLogs)
        .where(inArray(toolActionLogs.eventId, eventIds));

      // Delete executions of these events' jobs, then the jobs themselves
      // (logs reference jobs, executions reference jobs)
      await db
        .delete(executions)
        .where(
          inArray(
            executions.jobId,
            db
              .select({ id: jobs.id })
              .from(jobs)
              .where(inArray(jobs.eventId, eventIds)),
          ),
        );
      await db.delete(jobs).where(inArray(jobs.eventId, eventIds));

      // Delete environment variables
      await db.delete(envVars).where(inArray(envVars.eventId, eventIds));

      // Delete event servers
      await db
        .delete(eventServers)
        .where(inArray(eventServers.eventId, eventIds));

      // Delete workflow nodes that reference these events
      await db
        .delete(workflowNodes)
        .where(inArray(workflowNodes.eventId, eventIds));

      // Delete the events themselves
      await db.delete(events).where(inArray(events.id, eventIds));
    }

    // Delete the user's servers
    await db.delete(servers).where(eq(servers.userId, id));

    // Delete the user's API tokens
    const userTokens = await this.getUserApiTokens(id);
    for (const token of userTokens) {
      await this.deleteApiToken(token.id);
    }

    // Delete the user
    await db.delete(users).where(eq(users.id, id));
    await invalidatePrincipal(id);
    await publishUserSocketRevocation(id, "user deleted");
  }

  // Role methods
  async listRoles(): Promise<Role[]> {
    return db.select().from(roles).orderBy(roles.id);
  }

  async getRoleById(id: number): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }

  async getRoleByName(name: string): Promise<Role | undefined> {
    const [role] = await db
      .select()
      .from(roles)
      .where(sql`lower(${roles.name}) = ${name.toLowerCase()}`);
    return role;
  }

  async getDefaultRole(): Promise<Role | undefined> {
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.isDefault, true));
    return role;
  }

  async updateRolePermissions(
    id: number,
    permissions: RolePermissions,
  ): Promise<Role | undefined> {
    await assertSocketSecurityStoreAvailable();
    const [updated] = await db
      .update(roles)
      .set({ permissions, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    if (updated) {
      await publishAllSocketRevocation("role permissions changed");
    }
    return updated;
  }

  // Script methods (now renamed to events)
  async getEvent(id: number): Promise<Script | undefined> {
    try {
      const [script] = await db.select().from(events).where(eq(events.id, id));
      return script ?? undefined;
    } catch (error) {
      // If the error is about missing payload_version column, use explicit column selection
      const err = error as { message?: string; code?: string };
      if (err?.message?.includes("payload_version") || err?.code === "42703") {
        const [script] = await db
          .select({
            id: events.id,
            userId: events.userId,
            name: events.name,
            description: events.description,
            shared: events.shared,
            type: events.type,
            content: events.content,
            httpMethod: events.httpMethod,
            httpUrl: events.httpUrl,
            httpHeaders: events.httpHeaders,
            httpBody: events.httpBody,
            toolActionConfig: events.toolActionConfig,
            status: events.status,
            triggerType: events.triggerType,
            scheduleNumber: events.scheduleNumber,
            scheduleUnit: events.scheduleUnit,
            customSchedule: events.customSchedule,
            scheduleKind: events.scheduleKind,
            timezone: events.timezone,
            catchupPolicy: events.catchupPolicy,
            overlapPolicy: events.overlapPolicy,
            misfireGraceS: events.misfireGraceS,
            leaseLossPolicy: events.leaseLossPolicy,
            priority: events.priority,
            runLocation: events.runLocation,
            serverId: events.serverId,
            timeoutValue: events.timeoutValue,
            timeoutUnit: events.timeoutUnit,
            retries: events.retries,
            startTime: events.startTime,
            executionCount: events.executionCount,
            maxExecutions: events.maxExecutions,
            resetCounterOnActive: events.resetCounterOnActive,
            lastRunAt: events.lastRunAt,
            nextRunAt: events.nextRunAt,
            successCount: events.successCount,
            failureCount: events.failureCount,
            source: events.source,
            tags: events.tags,
            createdAt: events.createdAt,
            updatedAt: events.updatedAt,
          })
          .from(events)
          .where(eq(events.id, id));

        // Add default payloadVersion
        if (script) {
          return { ...script, payloadVersion: 1 };
        }
        return undefined;
      }
      throw error;
    }
  }

  // Check if a user has access to view an event (they own it or it's shared)
  async canViewEvent(eventId: number, userId: string): Promise<boolean> {
    try {
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
    } catch (error) {
      // If the error is about missing payload_version column, use a simpler query
      const err = error as { message?: string; code?: string };
      if (err?.message?.includes("payload_version") || err?.code === "42703") {
        const [script] = await db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.id, eventId),
              sql`(${events.userId} = ${userId} OR ${events.shared} = true)`,
            ),
          );
        return !!script;
      }
      throw error;
    }
  }

  // Check if a user has permission to edit/delete an event (they must own it)
  async canEditEvent(eventId: number, userId: string): Promise<boolean> {
    try {
      const [script] = await db
        .select()
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.userId, userId)));

      return !!script;
    } catch (error) {
      // If the error is about missing payload_version column, use a simpler query
      const err = error as { message?: string; code?: string };
      if (err?.message?.includes("payload_version") || err?.code === "42703") {
        const [script] = await db
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.id, eventId), eq(events.userId, userId)));
        return !!script;
      }
      throw error;
    }
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

      const event = await eventPromise;

      if (!event) {
        return undefined;
      }

      // Transform the data to match the expected EventWithRelations structure
      const servers =
        event.eventServers
          ?.map((es) => es.server)
          .filter((s): s is Server => s !== null) || [];
      const { eventServers: _eventServers, ...baseEvent } = event;
      void _eventServers;

      const result: EventWithRelations = {
        ...baseEvent,
        servers,
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
      };
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
      },
    });

    // Transform the results
    return activeEvents.map((event) => {
      const { eventServers: _eventServers, ...baseEvent } = event;
      void _eventServers;
      const transformed: EventWithRelations = {
        ...baseEvent,
        envVars: event.envVars ?? [],
        server: event.server ?? null,
        servers:
          event.eventServers?.map((es) => es.server).filter(Boolean) ?? [],
      };

      return transformed;
    });
  }

  async getAllEvents(userId: string): Promise<Event[]> {
    try {
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
        // Provide default for payload_version if missing
        payloadVersion:
          ((event as Record<string, unknown>).payloadVersion as number) ?? 1,
      }));

      return enrichedScripts;
    } catch (error) {
      // If the error is about missing payload_version column, provide a fallback
      const err = error as { message?: string; code?: string };
      if (err?.message?.includes("payload_version") || err?.code === "42703") {
        console.warn(
          "payload_version column missing - using fallback query. Run migration: pnpm tsx src/scripts/migrations/add-payload-version.ts",
        );

        // Fallback query without payload_version
        const eventsWithRelations = await db
          .select({
            id: events.id,
            userId: events.userId,
            name: events.name,
            description: events.description,
            shared: events.shared,
            type: events.type,
            content: events.content,
            httpMethod: events.httpMethod,
            httpUrl: events.httpUrl,
            httpHeaders: events.httpHeaders,
            httpBody: events.httpBody,
            toolActionConfig: events.toolActionConfig,
            status: events.status,
            triggerType: events.triggerType,
            scheduleNumber: events.scheduleNumber,
            scheduleUnit: events.scheduleUnit,
            customSchedule: events.customSchedule,
            scheduleKind: events.scheduleKind,
            timezone: events.timezone,
            catchupPolicy: events.catchupPolicy,
            overlapPolicy: events.overlapPolicy,
            misfireGraceS: events.misfireGraceS,
            leaseLossPolicy: events.leaseLossPolicy,
            priority: events.priority,
            runLocation: events.runLocation,
            serverId: events.serverId,
            timeoutValue: events.timeoutValue,
            timeoutUnit: events.timeoutUnit,
            retries: events.retries,
            startTime: events.startTime,
            executionCount: events.executionCount,
            maxExecutions: events.maxExecutions,
            resetCounterOnActive: events.resetCounterOnActive,
            lastRunAt: events.lastRunAt,
            nextRunAt: events.nextRunAt,
            successCount: events.successCount,
            failureCount: events.failureCount,
            source: events.source,
            tags: events.tags,
            createdAt: events.createdAt,
            updatedAt: events.updatedAt,
          })
          .from(events)
          .where(or(eq(events.userId, userId), eq(events.shared, true)))
          .orderBy(desc(events.updatedAt));

        // Add default payloadVersion and empty eventServers
        return eventsWithRelations.map((event) => ({
          ...event,
          payloadVersion: 1,
          eventServers: [],
        }));
      }

      // Re-throw other errors
      throw error;
    }
  }

  async queryEvents(
    userId: string,
    query: EventQueryInput,
  ): Promise<PaginatedResult<Event>> {
    const pagination = normalizePagination(query);
    const conditions: SQL[] = [
      buildUserAccessConditions(userId, events.userId, events.shared),
    ];

    if (query.status) {
      conditions.push(eq(events.status, query.status));
    }

    if (query.type) {
      conditions.push(eq(events.type, query.type));
    }

    if (typeof query.shared === "boolean") {
      conditions.push(eq(events.shared, query.shared));
    }

    const searchCondition = buildSearchConditions(query.search, [
      events.name,
      events.description,
    ]);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    const whereClause =
      conditions.length > 1 ? and(...conditions) : conditions[0]!;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const rows = await db.query.events.findMany({
      where: whereClause,
      orderBy: [desc(events.updatedAt)],
      limit: pagination.limit,
      offset: pagination.offset,
      with: {
        eventServers: {
          columns: {
            serverId: true,
          },
        },
      },
    });

    const items = rows.map((event) => ({
      ...event,
      eventServers: event.eventServers.map((es) => es.serverId),
      payloadVersion:
        ((event as Record<string, unknown>).payloadVersion as number) ?? 1,
    }));

    return createPaginatedResult(items, total, pagination);
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

  async createScript(insertScript: InsertEvent): Promise<Event> {
    return db.transaction(async (tx) => {
      if (
        insertScript.serverId !== null &&
        insertScript.serverId !== undefined
      ) {
        const [authorizedServer] = await tx
          .select({ id: servers.id })
          .from(servers)
          .where(
            and(
              eq(servers.id, insertScript.serverId),
              eq(servers.userId, insertScript.userId),
              eq(servers.isArchived, false),
            ),
          )
          .limit(1);
        if (!authorizedServer) {
          throw new Error("Unauthorized event server relationship");
        }
      }

      const [script] = await tx.insert(events).values(insertScript).returning();

      if (!script) {
        throw new Error("Failed to create script");
      }
      return script;
    });
  }

  async updateScript(
    id: number,
    updateData: Partial<InsertEvent>,
  ): Promise<Event> {
    // Ownership/provenance are immutable at the storage boundary. This keeps
    // a future route from reintroducing the legacy mass-assignment flaw.
    const {
      userId: _immutableUserId,
      source: _immutableSource,
      createdAt: _immutableCreatedAt,
      ...mutableUpdateData
    } = updateData;
    void _immutableUserId;
    void _immutableSource;
    void _immutableCreatedAt;

    // Special handling for boolean values to ensure they are stored correctly
    if (
      "resetCounterOnActive" in mutableUpdateData &&
      mutableUpdateData.resetCounterOnActive !== undefined
    ) {
      // Force the value to be a true boolean to prevent PostgreSQL string conversion
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      (mutableUpdateData as any).resetCounterOnActive =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        (mutableUpdateData as any).resetCounterOnActive === true;
      console.log(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        `In storage layer - resetCounterOnActive: ${String((mutableUpdateData as any).resetCounterOnActive)}`,
      );
    }

    return db.transaction(async (tx) => {
      if (
        mutableUpdateData.serverId !== null &&
        mutableUpdateData.serverId !== undefined
      ) {
        const [event] = await tx
          .select({ userId: events.userId })
          .from(events)
          .where(eq(events.id, id))
          .limit(1);
        if (!event) throw new Error("Event not found");

        const [authorizedServer] = await tx
          .select({ id: servers.id })
          .from(servers)
          .where(
            and(
              eq(servers.id, mutableUpdateData.serverId),
              eq(servers.userId, event.userId),
              eq(servers.isArchived, false),
            ),
          )
          .limit(1);
        if (!authorizedServer) {
          throw new Error("Unauthorized event server relationship");
        }
      }

      const [script] = await tx
        .update(events)
        .set(mutableUpdateData)
        .where(eq(events.id, id))
        .returning();

      if (!script) {
        throw new Error("Failed to update script - script not found");
      }
      return script;
    });
  }

  async deleteScript(id: number): Promise<void> {
    try {
      console.log(`Starting deletion of script ${id}`);

      // Delete related resources in proper order to avoid foreign key
      // conflicts, in a transaction so a failure leaves nothing half-deleted
      await db.transaction(async (tx) => {
        // 1. Delete environment variables first
        console.log(`Deleting environment variables for script ${id}`);
        await tx.delete(envVars).where(eq(envVars.eventId, id));

        // 2. Delete logs
        console.log(`Deleting logs for script ${id}`);
        await tx.delete(logs).where(eq(logs.eventId, id));

        // 3b. Delete tool action logs
        console.log(`Deleting tool action logs for script ${id}`);
        await tx.delete(toolActionLogs).where(eq(toolActionLogs.eventId, id));

        // 3c. Delete executions of this event's jobs, then the jobs
        // themselves (logs reference jobs, executions reference jobs)
        console.log(`Deleting executions and jobs for script ${id}`);
        await tx
          .delete(executions)
          .where(
            inArray(
              executions.jobId,
              tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.eventId, id)),
            ),
          );
        await tx.delete(jobs).where(eq(jobs.eventId, id));

        // 4. Delete workflow execution event associations
        console.log(`Deleting workflow execution events for script ${id}`);
        await tx
          .delete(workflowExecutionEvents)
          .where(eq(workflowExecutionEvents.eventId, id));

        // 5. Delete server associations
        console.log(`Deleting event server associations for script ${id}`);
        await tx.delete(eventServers).where(eq(eventServers.eventId, id));

        // 6. Delete workflow nodes that reference this script
        console.log(`Deleting workflow nodes for script ${id}`);
        await tx.delete(workflowNodes).where(eq(workflowNodes.eventId, id));

        // 7. Delete the script itself last
        console.log(`Deleting script ${id}`);
        await tx.delete(events).where(eq(events.id, id));
      });

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

    // Decrypt env var values (record-bound vault, legacy passthrough — 2.1)
    return vars.map((envVar) => {
      try {
        if (!envVar.value) return envVar;
        return {
          ...envVar,
          value: decryptEnvVarValue(envVar.value, eventId, envVar.key),
        };
      } catch (error) {
        console.error(`Error decrypting env var for event ${eventId}:`, error);
        // Return env var without decryption rather than failing
        return envVar;
      }
    });
  }

  async createEnvVar(insertEnvVar: InsertEnvVar): Promise<EnvVar> {
    // Encrypt the value record-bound to (eventId, key) before storing (2.1).
    const storedValue = insertEnvVar.value
      ? encryptEnvVarValue(
          insertEnvVar.value,
          insertEnvVar.eventId,
          insertEnvVar.key,
        )
      : insertEnvVar.value;

    const [envVar] = await db
      .insert(envVars)
      .values({ ...insertEnvVar, value: storedValue })
      .returning();

    if (!envVar) {
      throw new Error("Failed to create environment variable");
    }

    // Return decrypted data for immediate use
    return {
      ...envVar,
      value: envVar.value
        ? decryptEnvVarValue(envVar.value, envVar.eventId, envVar.key)
        : envVar.value,
    };
  }

  async deleteEnvVarsByEventId(eventId: number): Promise<void> {
    await db.delete(envVars).where(eq(envVars.eventId, eventId));
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

    // Date-range filter (independent of the single-day `date` filter)
    if (filters.startDate) {
      conditions.push(gte(logs.startTime, new Date(filters.startDate)));
    }
    if (filters.endDate) {
      conditions.push(lte(logs.startTime, new Date(filters.endDate)));
    }

    // Free-text search across the selected columns (ILIKE, case-insensitive
    // by default). The schema's "errorOutput" field maps to the `error` column.
    if (filters.search) {
      const fields = filters.searchFields?.length
        ? filters.searchFields
        : (["output", "errorOutput", "eventName"] as const);
      const term = `%${filters.search}%`;
      const likeOp = filters.caseSensitive ? like : ilike;
      const columnFor = (field: "output" | "errorOutput" | "eventName") =>
        field === "output"
          ? logs.output
          : field === "errorOutput"
            ? logs.error
            : logs.eventName;
      const searchConditions = fields.map((field) =>
        likeOp(columnFor(field), term),
      );
      const combined = or(...searchConditions);
      if (combined) {
        conditions.push(combined);
      }
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
      executionDuration: logs.executionDuration,
      setupDuration: logs.setupDuration,
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
    // Metadata reads deliberately retain encrypted credential fields. Callers
    // expose only ServerApiDto presence flags; plaintext resolution is limited
    // to the owner-bound, fail-closed getServerForExecution boundary below.
    return server;
  }

  /**
   * The only credential-bearing server resolver used by job/terminal
   * execution. Ownership and archival state are checked in the same query as
   * the credential fetch, and decryption failures are fatal rather than
   * returning ciphertext as if it were a usable secret.
   */
  async getServerForExecution(
    id: number,
    userId: string,
  ): Promise<Server | undefined> {
    const [server] = await db
      .select()
      .from(servers)
      .where(
        and(
          eq(servers.id, id),
          eq(servers.userId, userId),
          eq(servers.isArchived, false),
        ),
      )
      .limit(1);
    return server ? decryptServerRow(server) : undefined;
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

    // Bulk/list reads never need credential plaintext. API DTOs derive only
    // has-credential flags from the encrypted value's presence.
    return allUserServers;
  }

  async queryServers(
    userId: string,
    query: ServerQueryInput,
  ): Promise<PaginatedResult<Server>> {
    const pagination = normalizePagination(query);
    const conditions: SQL[] = [
      buildUserAccessConditions(userId, servers.userId, servers.shared),
      // Archived servers are listed only through the dedicated getArchived
      // endpoint (their credentials are purged); every getAll consumer — the
      // servers table, event form, console, workflow form — wants active only.
      eq(servers.isArchived, false),
    ];

    if (typeof query.shared === "boolean") {
      conditions.push(eq(servers.shared, query.shared));
    }

    if (typeof query.online === "boolean") {
      conditions.push(eq(servers.online, query.online));
    }

    const searchCondition = buildSearchConditions(query.search, [
      servers.name,
      servers.address,
    ]);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    const whereClause =
      conditions.length > 1 ? and(...conditions) : conditions[0]!;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(servers)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const rows = await db
      .select()
      .from(servers)
      .where(whereClause)
      .orderBy(asc(servers.name))
      .limit(pagination.limit)
      .offset(pagination.offset);

    return createPaginatedResult(rows, total, pagination);
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
    // Encrypt credential columns record-bound to the owning tenant (2.1).
    const encryptedData = encryptServerColumns(
      insertServer,
      insertServer.userId,
    );

    const [server] = await db.insert(servers).values(encryptedData).returning();

    if (!server) {
      throw new Error("Failed to create server");
    }
    // Return decrypted data for immediate use
    return decryptServerRow(server);
  }

  async updateServer(
    id: number,
    updateData: Partial<InsertServer>,
  ): Promise<Server> {
    const revokeSockets = changesTerminalAuthorization(updateData);
    if (revokeSockets) await assertSocketSecurityStoreAvailable();
    // Record-bound credential encryption needs the owning tenant (2.1).
    const [owner] = await db
      .select({ userId: servers.userId })
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);
    if (!owner) {
      throw new Error(`Server with id ${id} not found`);
    }
    const encryptedData = encryptServerColumns(updateData, owner.userId);

    const [server] = await db
      .update(servers)
      .set(encryptedData)
      .where(eq(servers.id, id))
      .returning();

    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    if (revokeSockets) {
      await publishUserSocketRevocation(
        server.userId,
        "server authorization changed",
      );
    }

    // Return decrypted data for immediate use
    return decryptServerRow(server);
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
    await assertSocketSecurityStoreAvailable();
    const server = await this.getServer(id);

    await db.transaction(async (tx) => {
      await tx.delete(eventServers).where(eq(eventServers.serverId, id));
      await tx
        .update(events)
        .set({
          runLocation: RunLocation.LOCAL,
          serverId: null,
          updatedAt: new Date(),
        })
        .where(eq(events.serverId, id));
      await tx
        .update(executions)
        .set({ serverId: null })
        .where(eq(executions.serverId, id));
      await tx.delete(servers).where(eq(servers.id, id));
    });
    if (server) {
      await publishUserSocketRevocation(server.userId, "server deleted");
    }
  }

  // Server group methods
  async getServerGroups(userId: string): Promise<ServerGroupWithServers[]> {
    const groups = await db.query.serverGroups.findMany({
      where: eq(serverGroups.userId, userId),
      orderBy: [asc(serverGroups.name)],
      with: {
        members: {
          columns: {
            serverId: true,
          },
        },
      },
    });

    return groups.map(({ members, ...group }) => ({
      ...group,
      serverIds: members.map((m) => m.serverId),
    }));
  }

  async getServerGroup(
    id: number,
  ): Promise<ServerGroupWithServers | undefined> {
    const group = await db.query.serverGroups.findFirst({
      where: eq(serverGroups.id, id),
      with: {
        members: {
          columns: {
            serverId: true,
          },
        },
      },
    });

    if (!group) return undefined;
    const { members, ...rest } = group;
    return { ...rest, serverIds: members.map((m) => m.serverId) };
  }

  async createServerGroup(
    userId: string,
    name: string,
    serverIds: number[],
  ): Promise<ServerGroupWithServers> {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .insert(serverGroups)
        .values({ userId, name })
        .returning();

      if (!group) {
        throw new Error("Failed to create server group");
      }

      if (serverIds.length > 0) {
        await tx
          .insert(serverGroupMembers)
          .values(
            serverIds.map((serverId) => ({ groupId: group.id, serverId })),
          );
      }

      return { ...group, serverIds };
    });
  }

  async updateServerGroup(
    id: number,
    name: string,
    serverIds: number[],
  ): Promise<ServerGroupWithServers> {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .update(serverGroups)
        .set({ name, updatedAt: new Date() })
        .where(eq(serverGroups.id, id))
        .returning();

      if (!group) {
        throw new Error("Failed to update server group - group not found");
      }

      // Replace membership wholesale
      await tx
        .delete(serverGroupMembers)
        .where(eq(serverGroupMembers.groupId, id));
      if (serverIds.length > 0) {
        await tx
          .insert(serverGroupMembers)
          .values(serverIds.map((serverId) => ({ groupId: id, serverId })));
      }

      return { ...group, serverIds };
    });
  }

  async deleteServerGroup(id: number): Promise<void> {
    // Members are removed by the FK cascade
    await db.delete(serverGroups).where(eq(serverGroups.id, id));
  }

  // Server soft-delete cleanup methods (used by serverCleanupService)
  async permanentlyDeleteServer(id: number): Promise<void> {
    const server = await this.getServer(id);
    if (!server) {
      throw new Error(`Server ${id} not found`);
    }
    if (!server.isArchived) {
      throw new Error(
        `Server ${id} must be archived before permanent deletion`,
      );
    }
    await this.deleteServer(id);
  }

  async getServersScheduledForDeletion(limit = 10): Promise<Server[]> {
    const now = new Date();
    const serversToDelete = await db
      .select()
      .from(servers)
      .where(
        and(
          eq(servers.isArchived, true),
          lte(servers.deletionScheduledAt, now),
        ),
      )
      .limit(limit);

    return serversToDelete.map((server) => {
      if (server.sshKeyPurged) server.sshKey = null;
      if (server.passwordPurged) server.password = null;
      return server;
    });
  }

  async getServersApproachingDeletion(daysAhead: number): Promise<Server[]> {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysAhead);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const serversApproaching = await db
      .select()
      .from(servers)
      .where(
        and(
          eq(servers.isArchived, true),
          gte(servers.deletionScheduledAt, startOfDay),
          lte(servers.deletionScheduledAt, endOfDay),
        ),
      );

    return serversApproaching.map((server) => {
      if (server.sshKeyPurged) server.sshKey = null;
      if (server.passwordPurged) server.password = null;
      return server;
    });
  }

  async hasNotificationBeenSent(
    serverId: number,
    notificationType: string,
  ): Promise<boolean> {
    const [notification] = await db
      .select()
      .from(serverDeletionNotifications)
      .where(
        and(
          eq(serverDeletionNotifications.serverId, serverId),
          eq(serverDeletionNotifications.notificationType, notificationType),
        ),
      )
      .limit(1);
    return !!notification;
  }

  async createDeletionNotification(
    serverId: number,
    userId: string,
    notificationType: string,
  ): Promise<void> {
    await db.insert(serverDeletionNotifications).values({
      serverId,
      userId,
      notificationType,
    });
  }

  // Settings methods
  async getSetting(key: string): Promise<Setting | undefined> {
    const [setting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));

    // Decrypt sensitive settings
    if (setting && isSystemSettingSensitive(key)) {
      try {
        return {
          ...setting,
          value: decryptSystemSetting(setting.value, key),
        };
      } catch (error) {
        console.error(`Error decrypting system setting ${key}:`, error);
        // Return setting without decryption rather than failing
        return setting;
      }
    }

    return setting;
  }

  async getAllSettings(): Promise<Setting[]> {
    const allSettings = await db.select().from(systemSettings);

    // Decrypt sensitive settings
    return allSettings.map((setting) => {
      if (isSystemSettingSensitive(setting.key)) {
        try {
          return {
            ...setting,
            value: decryptSystemSetting(setting.value, setting.key),
          };
        } catch (error) {
          console.error(
            `Error decrypting system setting ${setting.key}:`,
            error,
          );
          // Return setting without decryption rather than failing
          return setting;
        }
      }
      return setting;
    });
  }

  async upsertSetting(key: string, value: string): Promise<Setting> {
    // Encrypt sensitive values before storing (record-bound to the key; 2.1)
    const valueToStore = isSystemSettingSensitive(key)
      ? encryptSystemSetting(value, key)
      : value;

    // Check if the setting exists (raw from DB, not decrypted)
    const [existingSetting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));

    if (existingSetting) {
      // Update the existing setting
      const [setting] = await db
        .update(systemSettings)
        .set({ value: valueToStore, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
        .returning();

      if (!setting) {
        throw new Error("Failed to update setting");
      }

      // Return decrypted value for immediate use
      if (isSystemSettingSensitive(key)) {
        return { ...setting, value };
      }
      return setting;
    } else {
      // Create a new setting
      const [setting] = await db
        .insert(systemSettings)
        .values({
          key,
          value: valueToStore,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!setting) {
        throw new Error("Failed to create setting");
      }

      // Return decrypted value for immediate use
      if (isSystemSettingSensitive(key)) {
        return { ...setting, value };
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

  async queryWorkflows(
    userId: string,
    query: WorkflowQueryInput,
  ): Promise<PaginatedResult<Workflow>> {
    const pagination = normalizePagination(query);
    const conditions: SQL[] = [eq(workflows.userId, userId)];

    if (query.status) {
      conditions.push(eq(workflows.status, query.status));
    }

    if (query.triggerType) {
      conditions.push(eq(workflows.triggerType, query.triggerType));
    }

    if (typeof query.shared === "boolean") {
      conditions.push(eq(workflows.shared, query.shared));
    }

    const searchCondition = buildSearchConditions(query.search, [
      workflows.name,
      workflows.description,
    ]);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    const whereClause =
      conditions.length > 1 ? and(...conditions) : conditions[0]!;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workflows)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const rows = await db.query.workflows.findMany({
      where: whereClause,
      orderBy: [asc(workflows.name)],
      limit: pagination.limit,
      offset: pagination.offset,
    });

    return createPaginatedResult(rows, total, pagination);
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
    const workflow = await db.transaction(async (tx) => {
      const overrideServerIds = Array.isArray(insertWorkflow.overrideServerIds)
        ? insertWorkflow.overrideServerIds.filter(
            (value): value is number =>
              Number.isInteger(value) && Number(value) > 0,
          )
        : [];
      if (overrideServerIds.length > 0) {
        const uniqueIds = [...new Set(overrideServerIds)];
        const ownedServers = await tx
          .select({ id: servers.id })
          .from(servers)
          .where(
            and(
              inArray(servers.id, uniqueIds),
              eq(servers.userId, insertWorkflow.userId),
              eq(servers.isArchived, false),
            ),
          );
        if (ownedServers.length !== uniqueIds.length) {
          throw new Error("Unauthorized workflow server relationship");
        }
      }

      const [created] = await tx
        .insert(workflows)
        .values(insertWorkflow)
        .returning();
      return created;
    });

    if (!workflow) {
      throw new Error("Failed to create workflow");
    }

    // Materialize the durable schedule for SCHEDULE-triggered workflows
    const { refreshWorkflowSchedule } =
      await import("@/lib/scheduling/materialize");
    await refreshWorkflowSchedule(workflow.id).catch(() => undefined);
    return workflow;
  }

  async getWorkflowWithRelations(
    id: number,
  ): Promise<WorkflowWithRelations | null> {
    // Fetch workflow with all relations in a single query
    const workflowWithRelations = await db.query.workflows.findFirst({
      where: eq(workflows.id, id),
      with: {
        nodes: {
          with: {
            event: {
              with: {
                envVars: true,
                server: true,
                eventServers: {
                  with: {
                    server: true,
                  },
                },
              },
            },
          },
        },
        connections: true,
      },
    });

    if (!workflowWithRelations) return null;

    // Transform nodes to include properly structured event relations
    const nodesWithEvents: WorkflowNodeWithEvent[] =
      workflowWithRelations.nodes.map((node): WorkflowNodeWithEvent => {
        if (node.event) {
          // Transform event data to match EventWithRelations structure
          const servers =
            node.event.eventServers
              ?.map((es) => es.server)
              .filter((s): s is Server => s !== null) || [];

          const { eventServers: _eventServers, ...baseEvent } = node.event;
          void _eventServers;
          const eventWithRelations: EventWithRelations = {
            ...baseEvent,
            envVars: node.event.envVars ?? [],
            server: node.event.server ?? null,
            servers,
          };

          return {
            ...node,
            event: eventWithRelations,
          };
        }
        // Return node without event property when event is not present
        return {
          ...node,
          event: undefined,
        };
      });

    return {
      ...workflowWithRelations,
      nodes: nodesWithEvents,
    };
  }

  async updateWorkflow(
    id: number,
    updateData: Partial<InsertWorkflow>,
  ): Promise<Workflow> {
    const {
      userId: _immutableUserId,
      source: _immutableSource,
      createdAt: _immutableCreatedAt,
      ...mutableUpdateData
    } = updateData;
    void _immutableUserId;
    void _immutableSource;
    void _immutableCreatedAt;

    const workflow = await db.transaction(async (tx) => {
      if (Array.isArray(mutableUpdateData.overrideServerIds)) {
        const uniqueIds = [
          ...new Set(
            mutableUpdateData.overrideServerIds.filter(
              (value): value is number =>
                Number.isInteger(value) && Number(value) > 0,
            ),
          ),
        ];
        const [owner] = await tx
          .select({ userId: workflows.userId })
          .from(workflows)
          .where(eq(workflows.id, id))
          .limit(1);
        if (!owner) throw new Error("Workflow not found");
        if (uniqueIds.length > 0) {
          const ownedServers = await tx
            .select({ id: servers.id })
            .from(servers)
            .where(
              and(
                inArray(servers.id, uniqueIds),
                eq(servers.userId, owner.userId),
                eq(servers.isArchived, false),
              ),
            );
          if (ownedServers.length !== uniqueIds.length) {
            throw new Error("Unauthorized workflow server relationship");
          }
        }
      }

      const [updated] = await tx
        .update(workflows)
        .set(mutableUpdateData)
        .where(eq(workflows.id, id))
        .returning();
      return updated;
    });

    if (!workflow) {
      throw new Error("Failed to update workflow - workflow not found");
    }

    // Re-materialize the durable schedule when anything schedule-affecting
    // changed (status, trigger, cadence). One hook covers every router call
    // site — see src/lib/scheduling/materialize.ts.
    if (
      "status" in mutableUpdateData ||
      "triggerType" in mutableUpdateData ||
      "scheduleNumber" in mutableUpdateData ||
      "scheduleUnit" in mutableUpdateData ||
      "customSchedule" in mutableUpdateData
    ) {
      const { refreshWorkflowSchedule } =
        await import("@/lib/scheduling/materialize");
      await refreshWorkflowSchedule(id).catch((error) => {
        console.error(
          `Failed to refresh schedule for workflow ${id}:`,
          error instanceof Error ? error.message : String(error),
        );
      });
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
    const node = await db.transaction(async (tx) => {
      const [relationship] = await tx
        .select({
          workflowUserId: workflows.userId,
          eventUserId: events.userId,
        })
        .from(workflows)
        .innerJoin(events, eq(events.id, insertNode.eventId))
        .where(eq(workflows.id, insertNode.workflowId))
        .limit(1);
      if (
        !relationship ||
        relationship.workflowUserId !== relationship.eventUserId
      ) {
        throw new Error("Unauthorized workflow event relationship");
      }

      const [created] = await tx
        .insert(workflowNodes)
        .values(insertNode)
        .returning();
      return created;
    });

    if (!node) {
      throw new Error("Failed to create workflow node");
    }
    return node;
  }

  async updateWorkflowNode(
    id: number,
    updateData: Partial<InsertWorkflowNode>,
  ): Promise<WorkflowNode> {
    const node = await db.transaction(async (tx) => {
      if (updateData.eventId !== undefined) {
        const [relationship] = await tx
          .select({
            workflowUserId: workflows.userId,
            eventUserId: events.userId,
          })
          .from(workflowNodes)
          .innerJoin(workflows, eq(workflows.id, workflowNodes.workflowId))
          .innerJoin(events, eq(events.id, updateData.eventId))
          .where(eq(workflowNodes.id, id))
          .limit(1);
        if (
          !relationship ||
          relationship.workflowUserId !== relationship.eventUserId
        ) {
          throw new Error("Unauthorized workflow event relationship");
        }
      }

      const [updated] = await tx
        .update(workflowNodes)
        .set(updateData)
        .where(eq(workflowNodes.id, id))
        .returning();
      return updated;
    });

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

  async getUserWorkflowExecutions(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ executions: WorkflowExecution[]; total: number }> {
    // Get all workflow executions for a user's workflows in a single query
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
      })
      .from(workflowExecutions)
      .innerJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflows.userId, userId))
      .orderBy(desc(workflowExecutions.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(workflowExecutions)
      .innerJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(eq(workflows.userId, userId));

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
    userId: string,
  ): Promise<EventServer> {
    const eventServer = await db.transaction(async (tx) => {
      const [authorized] = await tx
        .select({ eventId: events.id, serverId: servers.id })
        .from(events)
        .innerJoin(servers, eq(servers.id, serverId))
        .where(
          and(
            eq(events.id, eventId),
            eq(events.userId, userId),
            eq(servers.userId, userId),
            eq(servers.isArchived, false),
          ),
        )
        .limit(1);
      if (!authorized) {
        throw new Error("Unauthorized event server relationship");
      }

      const [created] = await tx
        .insert(eventServers)
        .values({ eventId, serverId })
        .returning();
      return created;
    });

    if (!eventServer) {
      throw new Error("Failed to add event server association");
    }
    return eventServer;
  }

  async removeEventServer(
    eventId: number,
    serverId: number,
    userId: string,
  ): Promise<void> {
    await db.delete(eventServers).where(
      and(
        eq(eventServers.eventId, eventId),
        eq(eventServers.serverId, serverId),
        sql`EXISTS (
            SELECT 1 FROM ${events}
            WHERE ${events.id} = ${eventId}
              AND ${events.userId} = ${userId}
          )`,
      ),
    );
  }

  async setEventServers(
    eventId: number,
    serverIds: number[],
    userId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [ownedEvent] = await tx
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.userId, userId)))
        .limit(1);
      if (!ownedEvent) throw new Error("Unauthorized event relationship");

      const ids = [...new Set(serverIds)];
      if (ids.length > 0) {
        const ownedServers = await tx
          .select({ id: servers.id })
          .from(servers)
          .where(
            and(
              inArray(servers.id, ids),
              eq(servers.userId, userId),
              eq(servers.isArchived, false),
            ),
          );
        if (ownedServers.length !== ids.length) {
          throw new Error("Unauthorized event server relationship");
        }
      }

      await tx.delete(eventServers).where(eq(eventServers.eventId, eventId));
      if (ids.length > 0) {
        await tx
          .insert(eventServers)
          .values(ids.map((serverId) => ({ eventId, serverId })));
      }
    });
  }

  // API Token methods
  //
  // Tokens are stored as a one-way SHA-256 hash (see lib/api-token-hash.ts), so
  // the raw value only ever exists at creation time. Read paths therefore
  // return the stored hash in the `token` field — callers must never surface it
  // (the auth router already strips `token` from every response), so no
  // decryption happens here.
  async getApiToken(id: number): Promise<ApiToken | undefined> {
    const [token] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, id));
    return token;
  }

  async getApiTokenByToken(token: string): Promise<ApiToken | undefined> {
    const tokenHash = hashApiToken(token);

    // Fast path: indexed equality lookup on the hash (constant work per request,
    // no decryption). This is the only path once all tokens are migrated.
    const [byHash] = await db
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.token, tokenHash),
          eq(apiTokens.status, TokenStatus.ACTIVE),
        ),
      );
    if (byHash) {
      return byHash;
    }

    // Legacy fallback: tokens created before hashing are stored encrypted.
    // Decrypt-compare ONLY those rows that aren't already hashes, and migrate a
    // match to a hash on use so this scan shrinks to nothing over time.
    const legacyTokens = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.status, TokenStatus.ACTIVE));

    for (const apiToken of legacyTokens) {
      if (
        typeof apiToken.token !== "string" ||
        isHashedApiToken(apiToken.token)
      ) {
        continue;
      }
      try {
        if (encryptionService.decrypt(apiToken.token) === token) {
          const [migrated] = await db
            .update(apiTokens)
            .set({ token: tokenHash })
            .where(eq(apiTokens.id, apiToken.id))
            .returning();
          return migrated ?? { ...apiToken, token: tokenHash };
        }
      } catch (error) {
        console.error(
          `Failed to decrypt legacy API token (ID: ${apiToken.id}):`,
          error instanceof Error ? error.message : "Unknown error",
        );
        continue;
      }
    }

    return undefined;
  }

  async getUserApiTokens(userId: string): Promise<ApiToken[]> {
    return db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));
  }

  async createApiToken(insertToken: InsertApiToken): Promise<ApiToken> {
    const [token] = await db
      .insert(apiTokens)
      .values({ ...insertToken, token: hashApiToken(insertToken.token) })
      .returning();

    if (!token) {
      throw new Error("Failed to create API token");
    }
    // Return the raw token once so the caller can display it a single time; it
    // is not retrievable afterwards.
    return { ...token, token: insertToken.token };
  }

  async updateApiToken(
    id: number,
    updateData: Partial<InsertApiToken>,
  ): Promise<ApiToken> {
    const updateDataWithHash = { ...updateData };

    if (updateData.token) {
      updateDataWithHash.token = hashApiToken(updateData.token);
    }

    const [token] = await db
      .update(apiTokens)
      .set({ ...updateDataWithHash, updatedAt: new Date() })
      .where(eq(apiTokens.id, id))
      .returning();

    if (!token) {
      throw new Error("Failed to update API token - token not found");
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

    return variable ? decryptVariableRow(variable) : undefined;
  }

  async setUserVariable(
    userId: string,
    key: string,
    value: string,
    description?: string,
  ): Promise<UserVariable> {
    // Encrypt at rest, bound to this user + key (HI-09).
    const storedValue = encryptVariableValue(value, userId, key);
    // Try to update existing variable first
    const existingVariable = await this.getUserVariable(userId, key);

    if (existingVariable) {
      const [updatedVariable] = await db
        .update(userVariables)
        .set({
          value: storedValue,
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
      return decryptVariableRow(updatedVariable);
    } else {
      // Create new variable
      const [newVariable] = await db
        .insert(userVariables)
        .values({
          userId,
          key,
          value: storedValue,
          description,
        })
        .returning();

      if (!newVariable) {
        throw new Error("Failed to create user variable");
      }
      return decryptVariableRow(newVariable);
    }
  }

  async getUserVariables(userId: string): Promise<UserVariable[]> {
    const variables = await db
      .select()
      .from(userVariables)
      .where(eq(userVariables.userId, userId))
      .orderBy(asc(userVariables.key));

    return variables.map(decryptVariableRow);
  }

  async queryUserVariables(
    userId: string,
    query: VariableQueryInput,
  ): Promise<PaginatedResult<UserVariable>> {
    const pagination = normalizePagination(query);
    const conditions: SQL[] = [eq(userVariables.userId, userId)];

    // Value is encrypted at rest, so it is not searchable (search key/description).
    const searchCondition = buildSearchConditions(query.search, [
      userVariables.key,
      userVariables.description,
    ]);

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    const whereClause =
      conditions.length > 1 ? and(...conditions) : conditions[0]!;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userVariables)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const sortFieldMap = {
      key: userVariables.key,
      createdAt: userVariables.createdAt,
      updatedAt: userVariables.updatedAt,
    } as const;

    const sortColumn = sortFieldMap[query.sortBy ?? "key"] ?? userVariables.key;

    const orderByClause =
      (query.sortOrder ?? "asc") === "desc"
        ? desc(sortColumn)
        : asc(sortColumn);

    const rows = await db.query.userVariables.findMany({
      where: whereClause,
      orderBy: [orderByClause],
      limit: pagination.limit,
      offset: pagination.offset,
    });

    return createPaginatedResult(
      rows.map(decryptVariableRow),
      total,
      pagination,
    );
  }

  async createUserVariable(
    insertVariable: InsertUserVariable,
  ): Promise<UserVariable> {
    const encrypted =
      insertVariable.value !== undefined
        ? {
            ...insertVariable,
            value: encryptVariableValue(
              insertVariable.value,
              insertVariable.userId,
              insertVariable.key,
            ),
          }
        : insertVariable;
    const [variable] = await db
      .insert(userVariables)
      .values(encrypted)
      .returning();

    if (!variable) {
      throw new Error("Failed to create user variable");
    }
    return decryptVariableRow(variable);
  }

  async updateUserVariable(
    id: number,
    userId: string,
    updateData: Partial<InsertUserVariable>,
  ): Promise<UserVariable | null> {
    // The value is bound to (userId, key); if either the key or the value
    // changes, re-encrypt under the resulting key so the binding stays valid.
    const set: Partial<InsertUserVariable> = { ...updateData };
    const keyChanging =
      updateData.key !== undefined || updateData.value !== undefined;
    if (keyChanging) {
      const [existing] = await db
        .select()
        .from(userVariables)
        .where(and(eq(userVariables.id, id), eq(userVariables.userId, userId)))
        .limit(1);
      if (existing) {
        const newKey = updateData.key ?? existing.key;
        const plaintext =
          updateData.value ??
          decryptVariableValue(existing.value, userId, existing.key);
        set.value = encryptVariableValue(plaintext, userId, newKey);
      }
    }
    const [variable] = await db
      .update(userVariables)
      .set(set)
      .where(and(eq(userVariables.id, id), eq(userVariables.userId, userId)))
      .returning();

    return variable ? decryptVariableRow(variable) : null;
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
  /**
   * Persist a password-reset token row. `insertToken.token` must be the
   * SHA-256 hex digest of the raw token (see api-token-hash.ts) — the raw
   * token is never stored, only emailed, so a database read cannot yield a
   * usable reset link. Back-compat note: plaintext tokens minted before this
   * change no longer match the hashed lookup and simply age out (1h TTL).
   */
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

  /** Look up a live (unused, unexpired) token by its SHA-256 hex digest. */
  async getPasswordResetToken(
    tokenHash: string,
  ): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, tokenHash),
          eq(passwordResetTokens.used, false),
          gte(passwordResetTokens.expiresAt, new Date()),
        ),
      );

    return resetToken;
  }

  async markPasswordResetTokenAsUsed(tokenHash: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.token, tokenHash));
  }

  /**
   * Atomically consume a password-reset token: mark it used only if it is
   * currently unused and unexpired, returning the row when this call is the one
   * that consumed it. A conditional UPDATE ... RETURNING makes this a single
   * atomic claim, so two concurrent reset requests with the same token cannot
   * both succeed (closes the check-then-use race — ME-03). Takes the SHA-256
   * hex digest of the presented token — tokens are stored hashed at rest.
   */
  async consumePasswordResetToken(
    tokenHash: string,
  ): Promise<PasswordResetToken | undefined> {
    const [consumed] = await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(
        and(
          eq(passwordResetTokens.token, tokenHash),
          eq(passwordResetTokens.used, false),
          gte(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    return consumed;
  }

  async deleteExpiredPasswordResetTokens(): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()));
  }

  // Webhook methods
  async getActiveWebhooksForEvent(
    event: string,
    ownerUserId: string,
  ): Promise<(typeof webhooks.$inferSelect)[]> {
    // Fan-out is scoped to the owning tenant: a webhook (including a `*`
    // wildcard subscription) only ever receives its own tenant's events, never
    // another user's inbound payloads (HI-01).
    const activeWebhooks = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.active, true),
          eq(webhooks.userId, ownerUserId),
          or(
            sql`${webhooks.events}::jsonb @> ${JSON.stringify([event])}::jsonb`,
            sql`${webhooks.events}::jsonb @> ${JSON.stringify(["*"])}::jsonb`,
          ),
        ),
      );

    return activeWebhooks;
  }

  async getWebhookDeliveryWithRelations(deliveryId: string): Promise<{
    delivery: typeof webhookDeliveries.$inferSelect;
    webhook: typeof webhooks.$inferSelect;
    event: typeof webhookEvents.$inferSelect;
  } | null> {
    // Single query to get delivery with webhook and event data
    const result = await db
      .select({
        delivery: webhookDeliveries,
        webhook: webhooks,
        event: webhookEvents,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
      .innerJoin(
        webhookEvents,
        eq(webhookDeliveries.webhookEventId, webhookEvents.id),
      )
      .where(eq(webhookDeliveries.deliveryId, deliveryId))
      .limit(1);

    return result[0] ?? null;
  }

  async getUserWebhooksWithStats(userId: string): Promise<
    Array<{
      webhook: typeof webhooks.$inferSelect;
      totalDeliveries: number;
      successfulDeliveries: number;
      failedDeliveries: number;
    }>
  > {
    // Optimized query to get webhooks with delivery statistics
    const result = await db
      .select({
        webhook: webhooks,
        totalDeliveries: count(webhookDeliveries.id),
        successfulDeliveries: sql<number>`COUNT(CASE WHEN ${webhookDeliveries.status} = 'success' THEN 1 END)`,
        failedDeliveries: sql<number>`COUNT(CASE WHEN ${webhookDeliveries.status} = 'failed' THEN 1 END)`,
      })
      .from(webhooks)
      .leftJoin(webhookDeliveries, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(eq(webhooks.userId, userId))
      .groupBy(webhooks.id)
      .orderBy(desc(webhooks.createdAt));

    return result;
  }
}

export const storage: IStorage = new DatabaseStorage();
