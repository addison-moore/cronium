/**
 * @jest-environment node
 *
 * Admin router: responses never carry credential material, an admin cannot lock
 * the instance out of administration by editing themselves, and invite tokens
 * only exist in plaintext inside the email.
 */
jest.mock("nanoid", () => ({
  nanoid: () => "raw-invite-token",
  customAlphabet: () => () => "generated",
}));
jest.mock("@/env.mjs", () => ({
  env: { ORCHESTRATOR_URL: "http://orchestrator:8080" },
}));

const dbState: { rows: Array<Record<string, unknown>> } = { rows: [] };

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => {
        const result = Promise.resolve([{ value: 7 }]);
        return Object.assign(result, {
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve(dbState.rows)),
          })),
        });
      }),
    })),
  },
}));
jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(true)),
    delete: jest.fn(() => Promise.resolve(true)),
  },
}));
jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: { checkLimit: jest.fn(() => Promise.resolve()) },
}));
jest.mock("@/server/storage", () => ({
  storage: {
    getUser: jest.fn(),
    getUserByEmail: jest.fn(),
    getAllUsers: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
  },
}));
jest.mock("@/lib/email", () => ({
  sendInvitationEmail: jest.fn(() => Promise.resolve()),
  sendEmailDetailed: jest.fn(),
}));
jest.mock("@/lib/ai", () => ({ listAvailableModels: jest.fn() }));

import type { Session } from "next-auth";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { sendInvitationEmail } from "@/lib/email";
import { hashApiToken } from "@/lib/api-token-hash";
import { UserRole, UserStatus } from "@/shared/schema";

const s = storage as unknown as Record<string, jest.Mock>;

const ADMIN_ID = "admin-1";
const OTHER_ID = "user-2";

// Everything a raw users row holds that must never reach a client.
const SECRETS = {
  password: "$2b$12$HASH-SENTINEL",
  mfaSecret: "crn.1.MFA-SENTINEL",
  mfaRecoveryCodes: ["RECOVERY-SENTINEL"],
  inviteToken: "INVITE-SENTINEL",
  inviteExpiry: new Date(),
  sessionVersion: 4,
};

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER_ID,
    email: "user@example.com",
    username: "user",
    firstName: null,
    lastName: null,
    profileImageUrl: null,
    role: UserRole.USER,
    roleId: 2,
    status: UserStatus.PENDING,
    lastLogin: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...SECRETS,
    ...overrides,
  };
}

function expectNoSecrets(result: unknown) {
  const body = JSON.stringify(result);
  for (const sentinel of ["SENTINEL"]) {
    expect(body).not.toContain(sentinel);
  }
  expect(body).not.toContain('"password"');
  expect(body).not.toContain('"mfaSecret"');
  expect(body).not.toContain('"mfaRecoveryCodes"');
  expect(body).not.toContain('"inviteToken"');
}

const caller = () =>
  createCaller({
    session: {
      user: {
        id: ADMIN_ID,
        email: "admin@example.com",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        sessionVersion: 1,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRONIUM_ENFORCE_ADMIN_MFA = "false";
  dbState.rows = [
    {
      id: ADMIN_ID,
      role: UserRole.ADMIN,
      roleId: 1,
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
      mfaEnabled: true,
    },
  ];
  s.getUser!.mockImplementation((id: string) =>
    Promise.resolve(userRow({ id })),
  );
  s.updateUser!.mockImplementation(
    (id: string, data: Record<string, unknown>) =>
      Promise.resolve(userRow({ id, ...data, ...SECRETS })),
  );
  s.createUser!.mockImplementation((data: Record<string, unknown>) =>
    Promise.resolve(userRow({ ...data, password: SECRETS.password })),
  );
  s.getUserByEmail!.mockResolvedValue(undefined);
});

describe("mutation responses carry no credential material", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["updateUser", () => caller().admin.updateUser({ id: OTHER_ID })],
    [
      "toggleUserStatus",
      () =>
        caller().admin.toggleUserStatus({
          id: OTHER_ID,
          status: UserStatus.ACTIVE,
        }),
    ],
    ["approveUser", () => caller().admin.approveUser({ id: OTHER_ID })],
    ["denyUser", () => caller().admin.denyUser({ id: OTHER_ID })],
    ["enableUser", () => caller().admin.enableUser({ id: OTHER_ID })],
    ["disableUser", () => caller().admin.disableUser({ id: OTHER_ID })],
    ["promoteUser", () => caller().admin.promoteUser({ id: OTHER_ID })],
    [
      "inviteUser",
      () =>
        caller().admin.inviteUser({
          email: "new@example.com",
          role: UserRole.USER,
        }),
    ],
  ])("%s", async (_name, call) => {
    expectNoSecrets(await call());
  });
});

describe("an admin cannot lock the instance out by editing themselves", () => {
  it.each([
    ["demoting", { role: UserRole.USER }],
    ["demoting to viewer", { role: UserRole.VIEWER }],
    ["disabling", { status: UserStatus.DISABLED }],
  ])("refuses %s their own account", async (_label, change) => {
    await expect(
      caller().admin.updateUser({ id: ADMIN_ID, ...change }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.updateUser).not.toHaveBeenCalled();
  });

  it("still allows a harmless edit of their own account", async () => {
    await expect(
      caller().admin.updateUser({ id: ADMIN_ID, email: "new@example.com" }),
    ).resolves.toBeDefined();
    expect(s.updateUser).toHaveBeenCalledTimes(1);
  });

  it("still allows changing someone else's role", async () => {
    await caller().admin.updateUser({ id: OTHER_ID, role: UserRole.VIEWER });
    expect(s.updateUser).toHaveBeenCalledTimes(1);
  });
});

describe("invite tokens", () => {
  it("stores only the hash and emails the raw token", async () => {
    await caller().admin.inviteUser({
      email: "new@example.com",
      role: UserRole.USER,
    });

    const stored = s.createUser!.mock.calls[0]![0] as { inviteToken: string };
    const emailed = (sendInvitationEmail as jest.Mock).mock
      .calls[0]![1] as string;

    expect(stored.inviteToken).toBe(hashApiToken(emailed));
    expect(stored.inviteToken).not.toBe(emailed);
  });

  it("stores only the hash when resending", async () => {
    s.getUser!.mockResolvedValue(
      userRow({ status: UserStatus.INVITED, email: "new@example.com" }),
    );

    await caller().admin.resendInvitation({ id: OTHER_ID });

    const patch = s.updateUser!.mock.calls[0]![1] as { inviteToken: string };
    const emailed = (sendInvitationEmail as jest.Mock).mock
      .calls[0]![1] as string;
    expect(patch.inviteToken).toBe(hashApiToken(emailed));
  });
});

describe("getSystemStats", () => {
  it("counts every event, not just the first admin's", async () => {
    s.getAllUsers!.mockResolvedValue([userRow(), userRow({ id: ADMIN_ID })]);

    const result = await caller().admin.getSystemStats({ period: "day" });

    expect(JSON.stringify(result)).toContain('"totalEvents":7');
  });
});
