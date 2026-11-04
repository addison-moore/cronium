import { RunLocation, type Server, type User } from "@/shared/schema";
import type { EnvVar, Workflow } from "@/shared/schema";
import { decryptEnvVarValue } from "@/lib/security/field-secret";
import type {
  EventWithRelations,
  WorkflowWithRelations,
  WorkflowNodeWithEvent,
} from "@/server/storage";

/**
 * Explicit secret-free projection of a user row for admin responses (security
 * plan Phase 1.5). The raw row carries the bcrypt password hash and the
 * plaintext invite token/expiry — none of which may leave the server. Built as
 * an allowlist (not an Omit) so a future sensitive column is excluded by
 * default rather than leaked until someone remembers to strip it.
 */
export interface UserApiDto {
  id: string;
  email: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: User["role"];
  roleId: number | null;
  status: User["status"];
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hasPendingInvite: boolean;
}

export function toUserApiDto(user: User): UserApiDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    role: user.role,
    roleId: user.roleId,
    status: user.status,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    // Surface only the fact that an invite is outstanding, never the token.
    hasPendingInvite: Boolean(user.inviteToken),
  };
}

export type ServerApiDto = Omit<Server, "sshKey" | "password"> & {
  hasPrivateKey: boolean;
  hasPassword: boolean;
};

/** Server credentials are write-only on every browser/API response. */
export function toServerApiDto(server: Server): ServerApiDto {
  const { sshKey, password, ...safe } = server;
  return {
    ...safe,
    hasPrivateKey: Boolean(sshKey) && !server.sshKeyPurged,
    hasPassword: Boolean(password) && !server.passwordPurged,
  };
}

export type EventApiDto = Omit<EventWithRelations, "server" | "servers"> & {
  server?: ServerApiDto | null;
  servers: ServerApiDto[];
  secretFieldsRedacted: boolean;
};

/**
 * `event.envVars` holds ciphertext: storage returns the row as is so dispatch can
 * copy it into `jobs.payload` without ever persisting plaintext (ME-11). Anything
 * bound for a client has to come through here. Returning the stored value instead
 * is how the edit form came to display `crn.1...` and then re-encrypt it on save.
 */
function decryptedEnvVars(event: { id: number; envVars: EnvVar[] }): EnvVar[] {
  return event.envVars.map((envVar) => {
    if (!envVar.value) return envVar;
    try {
      return {
        ...envVar,
        value: decryptEnvVarValue(envVar.value, event.id, envVar.key),
      };
    } catch (error) {
      // Blank rather than ciphertext: a client must never be handed something it
      // could save back as the value. Usually means a retired key was removed.
      console.error(
        `Could not decrypt env var "${envVar.key}" of event ${event.id}:`,
        error instanceof Error ? error.message : String(error),
      );
      return { ...envVar, value: "" };
    }
  });
}

export interface EventDtoOptions {
  /**
   * Include env var values in plaintext for the owner. Off by default, so a
   * caller has to opt in; keys are still listed either way. Gate it with
   * `canReadEnvVarValues` from token-scopes.ts.
   */
  revealEnvVarValues?: boolean;
}

/**
 * Owners can read event configuration, but nested SSH credentials never leave
 * the server. Shared viewers receive a reusable template without environment,
 * HTTP-secret, or server bindings.
 */
export function toEventApiDto(
  event: EventWithRelations,
  viewerUserId: string,
  options: EventDtoOptions = {},
): EventApiDto {
  const owner = event.userId === viewerUserId;
  // Drizzle relation objects may carry an undeclared `eventServers` runtime
  // property containing nested raw server rows. Drop it defensively here even
  // though EventWithRelations exposes only the normalized `servers` array.
  const {
    server,
    servers: relatedServers,
    eventServers: _eventServers,
    ...baseEvent
  } = event as EventWithRelations & { eventServers?: unknown };
  void _eventServers;
  const safe: EventApiDto = {
    ...baseEvent,
    envVars: !owner
      ? []
      : options.revealEnvVarValues
        ? decryptedEnvVars(event)
        : event.envVars.map((envVar) => ({ ...envVar, value: "" })),
    serverId: owner ? event.serverId : null,
    ...(server !== undefined && {
      server: owner && server ? toServerApiDto(server) : null,
    }),
    servers: owner ? relatedServers.map(toServerApiDto) : [],
    httpUrl: owner ? event.httpUrl : null,
    httpHeaders: owner ? event.httpHeaders : [],
    httpBody: owner ? event.httpBody : null,
    toolActionConfig: owner ? event.toolActionConfig : null,
    secretFieldsRedacted: !owner,
  };
  return safe;
}

export function toEventListApiDto<
  T extends {
    userId: string;
    serverId?: number | null;
    httpHeaders?: unknown;
    httpUrl?: string | null;
    httpBody?: string | null;
    toolActionConfig?: unknown;
  },
>(event: T, viewerUserId: string): T & { secretFieldsRedacted: boolean } {
  if (event.userId === viewerUserId) {
    return { ...event, secretFieldsRedacted: false };
  }

  const safe = {
    ...event,
    serverId: null,
    httpUrl: null,
    httpHeaders: [],
    httpBody: null,
    toolActionConfig: null,
    secretFieldsRedacted: true,
  } as T & { secretFieldsRedacted: boolean; eventServers?: number[] };
  if ("eventServers" in safe) safe.eventServers = [];
  return safe;
}

/**
 * Project only the sensitive fields that may be copied while forking an
 * event. A shared template never transfers the owner's endpoints, headers,
 * environment, or server bindings into a resource owned by the viewer.
 */
export function toEventForkSecurityProjection(
  event: Pick<
    EventWithRelations,
    | "id"
    | "userId"
    | "httpUrl"
    | "httpHeaders"
    | "httpBody"
    | "runLocation"
    | "serverId"
    | "envVars"
    | "servers"
  >,
  viewerUserId: string,
) {
  const owner = event.userId === viewerUserId;
  return {
    owner,
    httpUrl: owner ? event.httpUrl : null,
    httpHeaders: owner ? event.httpHeaders : [],
    httpBody: owner ? event.httpBody : null,
    runLocation: owner ? event.runLocation : RunLocation.LOCAL,
    serverId: owner ? event.serverId : null,
    // Plaintext, because the fork re-encrypts under its own (eventId, key): the
    // source ciphertext is bound to this event and cannot decrypt anywhere else.
    envVars: owner ? decryptedEnvVars(event) : [],
    servers: owner ? event.servers : [],
  };
}

export function toWorkflowListApiDto<T extends Workflow>(
  workflow: T,
  viewerUserId: string,
): T & { hasWebhookKey: boolean; secretFieldsRedacted: boolean } {
  // The webhook key/hash are never returned (only the hash is stored); expose
  // a boolean so the UI can show "configured" without the credential (HI-12).
  const owner = workflow.userId === viewerUserId;
  return {
    ...workflow,
    webhookKey: null,
    webhookKeyHash: null,
    hasWebhookKey: Boolean(workflow.webhookKey ?? workflow.webhookKeyHash),
    overrideServerIds: owner ? workflow.overrideServerIds : [],
    secretFieldsRedacted: !owner,
  };
}

export type WorkflowApiDto = Omit<WorkflowWithRelations, "nodes"> & {
  nodes: Array<
    Omit<WorkflowNodeWithEvent, "event"> & {
      event?: EventApiDto | undefined;
    }
  >;
  // On reads `webhookKey` is null and `hasWebhookKey` reports whether one is
  // configured; create/rotate override `webhookKey` with the plaintext once.
  hasWebhookKey: boolean;
  secretFieldsRedacted: boolean;
};

export function toWorkflowApiDto(
  workflow: WorkflowWithRelations,
  viewerUserId: string,
): WorkflowApiDto {
  const owner = workflow.userId === viewerUserId;
  return {
    ...workflow,
    // Never expose the stored key or its hash on a read.
    webhookKey: null,
    webhookKeyHash: null,
    hasWebhookKey:
      owner && Boolean(workflow.webhookKey ?? workflow.webhookKeyHash),
    overrideServerIds: owner ? workflow.overrideServerIds : [],
    nodes: workflow.nodes.map((node) => ({
      ...node,
      event: node.event ? toEventApiDto(node.event, viewerUserId) : undefined,
    })),
    secretFieldsRedacted: !owner,
  };
}
