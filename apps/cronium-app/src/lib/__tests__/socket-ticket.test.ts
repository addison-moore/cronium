/**
 * @jest-environment node
 */
process.env.AUTH_SECRET = "test-auth-secret-for-socket-tickets";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as SocketIOServer } from "socket.io";
import {
  io as createSocketClient,
  type Socket as SocketIOClient,
} from "socket.io-client";

jest.mock("@/server/storage", () => ({
  storage: {
    getUser: jest.fn(),
  },
}));

import type { Socket } from "socket.io";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";
import {
  authenticateSocketTicket,
  createSocketAuthMiddleware,
  mintSocketTicket,
  socketUserAuthorizationFingerprint,
  verifySocketTicket,
} from "../socket-ticket";

const mockGetUser = storage.getUser as jest.Mock;
const consumedTicketIds = new Set<string>();
const consumeTicket = jest.fn(async (jti: string) => {
  if (consumedTicketIds.has(jti)) return false;
  consumedTicketIds.add(jti);
  return true;
});

beforeEach(() => {
  jest.clearAllMocks();
  consumedTicketIds.clear();
  mockGetUser.mockResolvedValue({
    id: "user-1",
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });
});

describe("socket tickets", () => {
  it("round-trips only for its intended namespace", () => {
    const { ticket, expiresIn } = mintSocketTicket("user-1", "terminal");

    expect(expiresIn).toBe(30);
    expect(verifySocketTicket(ticket, "terminal")).toMatchObject({
      typ: "cronium-socket",
      sub: "user-1",
      aud: "terminal",
    });
    expect(verifySocketTicket(ticket, "logs")).toBeNull();
  });

  it("rejects tampered and expired tickets", () => {
    const { ticket } = mintSocketTicket("user-1", "terminal");
    const tampered = `${ticket.slice(0, -2)}zz`;
    expect(verifySocketTicket(tampered, "terminal")).toBeNull();

    const old = Math.floor(Date.now() / 1000) - 31;
    const { ticket: expired } = mintSocketTicket("user-1", "terminal", old);
    expect(verifySocketTicket(expired, "terminal")).toBeNull();
  });

  it("accepts a ticket once and derives the current active user", async () => {
    const { ticket } = mintSocketTicket("user-1", "logs");

    await expect(
      authenticateSocketTicket(ticket, "logs", { consumeTicket }),
    ).resolves.toMatchObject({ userId: "user-1", role: UserRole.USER });
    await expect(
      authenticateSocketTicket(ticket, "logs", { consumeTicket }),
    ).resolves.toBeNull();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it("binds a socket principal to password, role, and status state", () => {
    const user = {
      id: "user-1",
      password: "password-hash-1",
      role: UserRole.USER,
      roleId: 2,
      status: UserStatus.ACTIVE,
    };
    const fingerprint = socketUserAuthorizationFingerprint(user);

    expect(
      socketUserAuthorizationFingerprint({
        ...user,
        password: "password-hash-2",
      }),
    ).not.toBe(fingerprint);
    expect(
      socketUserAuthorizationFingerprint({
        ...user,
        roleId: 3,
      }),
    ).not.toBe(fingerprint);
    expect(
      socketUserAuthorizationFingerprint({
        ...user,
        status: UserStatus.DISABLED,
      }),
    ).not.toBe(fingerprint);
  });

  it.each([UserStatus.DISABLED, UserStatus.PENDING, UserStatus.INVITED])(
    "rejects a user whose current status is %s",
    async (status) => {
      mockGetUser.mockResolvedValue({
        id: "user-1",
        role: UserRole.USER,
        status,
      });
      const { ticket } = mintSocketTicket("user-1", "logs");

      await expect(
        authenticateSocketTicket(ticket, "logs", { consumeTicket }),
      ).resolves.toBeNull();
    },
  );

  it("rejects a deleted user", async () => {
    mockGetUser.mockResolvedValue(undefined);
    const { ticket } = mintSocketTicket("user-1", "terminal");

    await expect(
      authenticateSocketTicket(ticket, "terminal", { consumeTicket }),
    ).resolves.toBeNull();
  });

  it("sets socket identity from the ticket instead of client user data", async () => {
    const { ticket } = mintSocketTicket("user-1", "terminal");
    const socket = {
      handshake: { auth: { ticket, userId: "attacker-chosen" } },
      data: {},
    } as unknown as Socket;

    const middleware = createSocketAuthMiddleware("terminal", {
      consumeTicket,
    });
    const error = await new Promise<Error | undefined>((resolve) => {
      middleware(socket, resolve);
    });

    expect(error).toBeUndefined();
    expect(socket.data.userId).toBe("user-1");
    expect(socket.data.authorizationFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("enforces the middleware over a live Socket.IO handshake", async () => {
    const httpServer = createServer();
    const ioServer = new SocketIOServer(httpServer, {
      transports: ["websocket"],
    });
    const terminalNamespace = ioServer.of("/terminal");
    terminalNamespace.use(
      createSocketAuthMiddleware("terminal", { consumeTicket }),
    );
    terminalNamespace.on("connection", (socket) => {
      socket.emit("authenticated-user", socket.data.userId);
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/terminal`;
    const clients: SocketIOClient[] = [];

    const connect = (auth: Record<string, unknown>): SocketIOClient => {
      const client = createSocketClient(url, {
        auth,
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
      });
      clients.push(client);
      return client;
    };

    try {
      const { ticket } = mintSocketTicket("user-1", "terminal");
      const authenticatedClient = connect({
        ticket,
        userId: "attacker-chosen",
      });
      await expect(
        new Promise<string>((resolve, reject) => {
          authenticatedClient.once("authenticated-user", resolve);
          authenticatedClient.once("connect_error", reject);
        }),
      ).resolves.toBe("user-1");

      authenticatedClient.close();

      const replayClient = connect({ ticket });
      await expect(
        new Promise<Error>((resolve) => {
          replayClient.once("connect_error", resolve);
        }),
      ).resolves.toMatchObject({ message: "Authentication failed" });

      const anonymousClient = connect({});
      await expect(
        new Promise<Error>((resolve) => {
          anonymousClient.once("connect_error", resolve);
        }),
      ).resolves.toMatchObject({ message: "Authentication required" });
    } finally {
      clients.forEach((client) => client.close());
      await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    }
  });
});
