/**
 * @jest-environment node
 */
jest.mock("@/server/storage", () => ({
  storage: {
    getUser: jest.fn(),
    getServerForExecution: jest.fn(),
  },
}));

jest.mock("@/server/permissions", () => ({
  hasServerPermission: jest.fn(),
}));

jest.mock("@/lib/ssh", () => ({
  sshService: { openShell: jest.fn() },
}));

import { storage } from "@/server/storage";
import { hasServerPermission } from "@/server/permissions";
import { UserRole, UserStatus, type Server } from "@/shared/schema";
import {
  authorizeTerminalServerAccess,
  isTerminalSessionOwnedBySocket,
  terminalAuthorizationFingerprint,
} from "../terminal-websocket";

const mockGetUser = storage.getUser as jest.Mock;
const mockGetServer = storage.getServerForExecution as jest.Mock;
const mockHasPermission = hasServerPermission as jest.Mock;

const ownedServer = {
  id: 7,
  userId: "user-1",
  name: "owned",
  address: "host.example",
  username: "runner",
  port: 22,
  shared: false,
  isArchived: false,
  sshKey: "private-key",
  password: null,
} as Server;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({
    id: "user-1",
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });
  mockHasPermission.mockResolvedValue(true);
  mockGetServer.mockResolvedValue(ownedServer);
});

describe("terminal server authorization", () => {
  it("allows the active owner with console permission", async () => {
    await expect(authorizeTerminalServerAccess("user-1", 7)).resolves.toBe(
      ownedServer,
    );
  });

  it("does not treat the shared flag as permission to use credentials", async () => {
    mockGetServer.mockResolvedValue({
      ...ownedServer,
      userId: "victim",
      shared: true,
    });

    await expect(authorizeTerminalServerAccess("user-1", 7)).rejects.toThrow(
      "access denied",
    );
  });

  it("rejects disabled users and users without console permission", async () => {
    mockGetUser.mockResolvedValue({
      id: "user-1",
      role: UserRole.USER,
      status: UserStatus.DISABLED,
    });
    await expect(authorizeTerminalServerAccess("user-1", 7)).rejects.toThrow(
      "access denied",
    );

    mockGetUser.mockResolvedValue({
      id: "user-1",
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });
    mockHasPermission.mockResolvedValue(false);
    await expect(authorizeTerminalServerAccess("user-1", 7)).rejects.toThrow(
      "access denied",
    );
  });
});

describe("terminal session ownership", () => {
  const session = { socketId: "socket-1", userId: "user-1" };

  it("requires both the creating socket and authenticated user", () => {
    expect(isTerminalSessionOwnedBySocket(session, "socket-1", "user-1")).toBe(
      true,
    );
    expect(isTerminalSessionOwnedBySocket(session, "socket-2", "user-1")).toBe(
      false,
    );
    expect(isTerminalSessionOwnedBySocket(session, "socket-1", "user-2")).toBe(
      false,
    );
  });
});

describe("terminal authorization fingerprint", () => {
  it("changes for credentials and connection targets, not display metadata", () => {
    const baseline = terminalAuthorizationFingerprint(ownedServer);

    expect(
      terminalAuthorizationFingerprint({
        ...ownedServer,
        name: "renamed",
        shared: true,
      }),
    ).toBe(baseline);
    expect(
      terminalAuthorizationFingerprint({
        ...ownedServer,
        sshKey: "rotated-private-key",
      }),
    ).not.toBe(baseline);
    expect(
      terminalAuthorizationFingerprint({ ...ownedServer, port: 2222 }),
    ).not.toBe(baseline);
    expect(baseline).not.toContain("private-key");
  });
});
