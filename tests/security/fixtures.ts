import {
  JobStatus,
  JobType,
  TokenStatus,
  UserRole,
  UserStatus,
} from "@/shared/schema";

const activeUser = (id: string, roleId: number) => ({
  id,
  role: UserRole.USER,
  roleId,
  status: UserStatus.ACTIVE,
});

export const securityFixtures = {
  roles: {
    admin: {
      id: 1,
      name: "Admin",
      permissions: { console: true, localServerAccess: true },
    },
    user: {
      id: 2,
      name: "User",
      permissions: { console: true, localServerAccess: false },
    },
    viewer: {
      id: 3,
      name: "Viewer",
      permissions: { console: false, localServerAccess: false },
    },
  },
  users: {
    owner: activeUser("security-owner", 2),
    attacker: activeUser("security-attacker", 2),
    viewer: activeUser("security-viewer", 3),
    admin: {
      id: "security-admin",
      role: UserRole.ADMIN,
      roleId: 1,
      status: UserStatus.ACTIVE,
    },
    disabled: {
      ...activeUser("security-owner", 2),
      status: UserStatus.DISABLED,
    },
    demoted: {
      ...activeUser("security-admin", 3),
      previousRole: UserRole.ADMIN,
    },
  },
  resources: {
    ownedEvent: { id: 10, userId: "security-owner", shared: false },
    sharedEvent: { id: 11, userId: "security-owner", shared: true },
    attackerEvent: { id: 12, userId: "security-attacker", shared: false },
    ownedServer: { id: 20, userId: "security-owner", shared: false },
    sharedServer: { id: 21, userId: "security-owner", shared: true },
    attackerServer: {
      id: 22,
      userId: "security-attacker",
      shared: false,
    },
    ownedWorkflow: { id: 30, userId: "security-owner", shared: false },
    sharedWorkflow: { id: 31, userId: "security-owner", shared: true },
  },
  tokens: {
    api: {
      id: 40,
      userId: "security-owner",
      status: TokenStatus.ACTIVE,
      scopes: ["events:read"],
    },
    mcp: {
      subject: "security-owner",
      clientId: "security-mcp-client",
      scope: "mcp:tools",
      audience: "https://cronium.test/api/mcp",
    },
  },
  jobs: {
    queued: {
      id: "security-job-queued",
      userId: "security-owner",
      eventId: 10,
      type: JobType.SCRIPT,
      status: JobStatus.QUEUED,
    },
    running: {
      id: "security-job-running",
      userId: "security-attacker",
      eventId: 12,
      type: JobType.SCRIPT,
      status: JobStatus.RUNNING,
    },
  },
} as const;
