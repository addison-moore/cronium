/**
 * @jest-environment node
 */

// Handler-level tests for /api/socket-ticket. Minting/verification itself is
// covered by src/lib/__tests__/socket-ticket.test.ts; here we test the ROUTE:
// authentication is required, the ticket is minted for the session user only,
// terminal access is capability-gated, and the response contract/no-store
// headers are correct. All lib boundaries are mocked.

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: { __marker: "authOptions" } }));

jest.mock("@/lib/socket-ticket", () => ({
  // Faithful to the real audience guard (["terminal", "logs"]).
  isSocketTicketAudience: (value: unknown) =>
    value === "terminal" || value === "logs",
  mintSocketTicket: jest.fn(() => ({
    ticket: "signed.socket.ticket",
    expiresIn: 30,
  })),
}));

jest.mock("@/server/permissions", () => ({ hasServerPermission: jest.fn() }));
jest.mock("@/server/security/authorization", () => ({
  roleAllowsCapability: jest.fn(),
}));
jest.mock("@/server/storage", () => ({ storage: { getUser: jest.fn() } }));

import { getServerSession } from "next-auth";
import { POST } from "../route";
import { mintSocketTicket } from "@/lib/socket-ticket";
import { hasServerPermission } from "@/server/permissions";
import { roleAllowsCapability } from "@/server/security/authorization";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";

const getServerSessionMock = getServerSession as jest.Mock;
const mintMock = mintSocketTicket as jest.Mock;
const hasServerPermissionMock = hasServerPermission as jest.Mock;
const roleAllowsCapabilityMock = roleAllowsCapability as jest.Mock;
const getUserMock = storage.getUser as jest.Mock;

const USER_ID = "user-1";

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    ...overrides,
  };
}

function post(body?: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost:5001/api/socket-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body !== undefined && {
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    }),
  );
}

function expectNoStore(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  expect(res.headers.get("Pragma")).toBe("no-cache");
}

beforeEach(() => {
  jest.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ user: { id: USER_ID } });
  getUserMock.mockResolvedValue(activeUser());
  roleAllowsCapabilityMock.mockReturnValue(true);
  hasServerPermissionMock.mockResolvedValue(true);
});

describe("POST /api/socket-ticket — authentication", () => {
  it("returns 401 with no session and never mints", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await post({ audience: "logs" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
    expect(mintMock).not.toHaveBeenCalled();
    expectNoStore(res);
  });

  it("returns 401 when the session has no user id", async () => {
    getServerSessionMock.mockResolvedValue({ user: {} });
    const res = await post({ audience: "logs" });
    expect(res.status).toBe(401);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("re-checks the database: unknown user is rejected despite a session", async () => {
    getUserMock.mockResolvedValue(undefined);
    const res = await post({ audience: "logs" });
    expect(res.status).toBe(401);
    expect(getUserMock).toHaveBeenCalledWith(USER_ID);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("re-checks the database: a disabled user is rejected despite a session", async () => {
    getUserMock.mockResolvedValue(activeUser({ status: UserStatus.DISABLED }));
    const res = await post({ audience: "logs" });
    expect(res.status).toBe(401);
    expect(mintMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/socket-ticket — request validation", () => {
  it("returns 400 for an unparseable body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing body", async () => {
    const res = await post();
    expect(res.status).toBe(400);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid audience", async () => {
    const res = await post({ audience: "admin-socket" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid audience" });
    expect(mintMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/socket-ticket — terminal capability gating", () => {
  it("denies terminal tickets to roles without the execute capability", async () => {
    getUserMock.mockResolvedValue(activeUser({ role: UserRole.VIEWER }));
    roleAllowsCapabilityMock.mockReturnValue(false);
    const res = await post({ audience: "terminal" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Access denied" });
    expect(roleAllowsCapabilityMock).toHaveBeenCalledWith(
      UserRole.VIEWER,
      "execute",
    );
    // Short-circuits before the granular console permission check.
    expect(hasServerPermissionMock).not.toHaveBeenCalled();
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("denies terminal tickets without the console permission", async () => {
    hasServerPermissionMock.mockResolvedValue(false);
    const res = await post({ audience: "terminal" });
    expect(res.status).toBe(403);
    expect(hasServerPermissionMock).toHaveBeenCalledWith(USER_ID, "console");
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("mints a terminal ticket for a permitted user", async () => {
    const res = await post({ audience: "terminal" });
    expect(res.status).toBe(200);
    expect(mintMock).toHaveBeenCalledTimes(1);
    expect(mintMock).toHaveBeenCalledWith(USER_ID, "terminal");
  });

  it("does not gate logs tickets on the execute capability", async () => {
    getUserMock.mockResolvedValue(activeUser({ role: UserRole.VIEWER }));
    roleAllowsCapabilityMock.mockReturnValue(false);
    const res = await post({ audience: "logs" });
    expect(res.status).toBe(200);
    expect(roleAllowsCapabilityMock).not.toHaveBeenCalled();
    expect(hasServerPermissionMock).not.toHaveBeenCalled();
    expect(mintMock).toHaveBeenCalledWith(USER_ID, "logs");
  });
});

describe("POST /api/socket-ticket — response contract", () => {
  it("returns the minted ticket with no-store headers", async () => {
    const res = await post({ audience: "logs" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ticket: "signed.socket.ticket",
      expiresIn: 30,
    });
    expectNoStore(res);
  });

  it("mints for the session user only — a userId in the body is ignored", async () => {
    const res = await post({ audience: "logs", userId: "attacker-99" });
    expect(res.status).toBe(200);
    expect(mintMock).toHaveBeenCalledTimes(1);
    expect(mintMock).toHaveBeenCalledWith(USER_ID, "logs");
    // The DB re-check also targets the session user, not the body value.
    expect(getUserMock).toHaveBeenCalledWith(USER_ID);
  });
});
