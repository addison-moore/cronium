import type { Capability } from "./authorization";

/**
 * Declared capability for every state-changing tRPC procedure.
 *
 * This is the route-by-role inventory required by the security plan (Phase
 * 1.1): every mutation must declare the capability it exercises, and a CI test
 * (`route-capability-inventory.test.ts`) fails when a mutation is added
 * without a declaration here. The `enforceRouteCapability` middleware in
 * trpc.ts enforces the declaration at runtime against the caller's live role;
 * an undeclared mutation is treated as `edit` (deny-by-default for Viewer)
 * until CI forces a declaration.
 *
 * `"public"` marks unauthenticated account-lifecycle flows (login, register,
 * password reset). They run as publicProcedure, so no role exists to check;
 * the declaration documents that this is intentional.
 *
 * Queries are implicitly `view`. Do not add queries here.
 */
export type RouteCapability = Capability | "public";

export const ROUTE_CAPABILITIES: Record<string, RouteCapability> = {
  // Platform administration — audited, no implicit resource/secret bypass.
  "admin.approveUser": "admin",
  "admin.bulkUserOperation": "admin",
  "admin.denyUser": "admin",
  "admin.disableUser": "admin",
  "admin.enableUser": "admin",
  "admin.inviteUser": "admin",
  "admin.listAiModels": "admin",
  "admin.promoteUser": "admin",
  "admin.resendInvitation": "admin",
  "admin.revokeUserSessions": "admin",
  "admin.sendTestEmail": "admin",
  "admin.toggleUserStatus": "admin",
  "admin.updateRolePermissions": "admin",
  "admin.updateSystemSettings": "admin",
  "admin.updateUser": "admin",

  "ai.generateScript": "edit",
  "ai.listModels": "edit",

  "auth.createApiToken": "edit",
  "auth.deleteApiToken": "edit",
  "auth.revokeApiToken": "edit",

  "events.activate": "edit",
  "events.create": "edit",
  "events.deactivate": "edit",
  "events.delete": "edit",
  "events.download": "view",
  "events.execute": "execute",
  "events.fork": "fork",
  "events.resetCounter": "edit",
  "events.update": "edit",

  "jobs.cancel": "execute",

  "logs.bulkOperation": "edit",
  "logs.create": "edit",
  "logs.delete": "edit",
  "logs.update": "edit",

  "mcp.validatePlan": "view",

  // Self-service MFA on the caller's own account. These manage the caller's
  // own security factor, so "edit" (any non-viewer principal) is appropriate;
  // each mutation independently reauthenticates with the account password.
  "mfa.beginEnrollment": "edit",
  "mfa.confirmEnrollment": "edit",
  "mfa.disable": "edit",
  "mfa.regenerateRecoveryCodes": "edit",

  "quotaManagement.exportReport": "view",
  "quotaManagement.resetUserQuotas": "admin",
  "quotaManagement.updateUserQuota": "admin",

  "servers.acknowledgeNotification": "edit",
  "servers.archive": "edit",
  "servers.bulkOperation": "edit",
  "servers.checkHealth": "use-secret",
  "servers.create": "edit",
  "servers.createGroup": "edit",
  "servers.delete": "edit",
  "servers.deleteGroup": "edit",
  "servers.permanentDelete": "edit",
  "servers.restore": "edit",
  "servers.testConnection": "use-secret",
  "servers.update": "edit",
  "servers.updateGroup": "edit",

  "settings.updateEditorSettings": "edit",

  "toolActionTemplates.clone": "fork",
  "toolActionTemplates.create": "edit",
  "toolActionTemplates.delete": "edit",
  "toolActionTemplates.update": "edit",

  "tools.create": "edit",
  "tools.delete": "edit",
  "tools.executeAction": "execute",
  "tools.revokeOAuthTokens": "edit",
  "tools.testConnection": "use-secret",
  "tools.testCredentials": "use-secret",
  "tools.update": "edit",
  "tools.slack.send": "execute",
  "tools.slack.testConnection": "use-secret",

  "userAuth.activateAccount": "public",
  "userAuth.deleteAccount": "edit",
  "userAuth.forgotPassword": "public",
  "userAuth.login": "public",
  "userAuth.register": "public",
  "userAuth.resetPassword": "public",
  "userAuth.updateProfile": "edit",

  "variables.bulkOperation": "edit",
  "variables.create": "edit",
  "variables.delete": "edit",
  "variables.deleteByKey": "edit",
  "variables.export": "view",
  "variables.update": "edit",
  "variables.validate": "view",

  "webhookSystem.create": "edit",
  "webhookSystem.delete": "edit",
  "webhookSystem.regenerateSecret": "edit",
  "webhookSystem.retryDelivery": "execute",
  "webhookSystem.test": "execute",
  "webhookSystem.update": "edit",

  "workflows.archive": "edit",
  "workflows.bulkOperation": "edit",
  "workflows.create": "edit",
  "workflows.delete": "edit",
  "workflows.download": "view",
  "workflows.execute": "execute",
  "workflows.rotateWebhookKey": "edit",
  "workflows.update": "edit",
};

/**
 * Runtime capability for a procedure. Queries default to `view`; a mutation
 * missing from the inventory falls back to `edit` so an undeclared route is
 * still denied to read-only roles rather than allowed.
 */
export function capabilityForRoute(
  path: string,
  type: "query" | "mutation" | "subscription",
): Capability {
  const declared = ROUTE_CAPABILITIES[path];
  if (declared && declared !== "public") return declared;
  if (declared === "public" || type === "query") return "view";
  return "edit";
}
