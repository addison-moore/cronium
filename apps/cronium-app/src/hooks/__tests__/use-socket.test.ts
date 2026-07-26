/**
 * use-socket — the shared (module-singleton) Socket.IO client.
 *
 * The hook keeps one socket for the whole app, created on the first mount and
 * intentionally never disconnected on unmount. Because that singleton lives
 * in module state, the tests in this file are ordered: the first test
 * observes creation, later tests observe reuse. socket.io-client and the
 * ticket/url helpers are fully mocked — no real network.
 */
import { act, renderHook } from "@testing-library/react";
import { io, type Socket } from "socket.io-client";

import { useSocket, useSocketConnection } from "@/hooks/use-socket";
import { createSocketAuthProvider } from "@/lib/socket-ticket-client";

jest.mock("socket.io-client", () => ({
  io: jest.fn(),
}));

jest.mock("@/lib/socket-ticket-client", () => ({
  createSocketAuthProvider: jest.fn(() => {
    const provider = (callback: (auth: { ticket: string }) => void) =>
      callback({ ticket: "test-ticket" });
    return provider;
  }),
}));

jest.mock("@/lib/socket-client-url", () => ({
  resolveSocketClientUrl: jest.fn(() => "http://socket.test"),
}));

type Handler = (...args: unknown[]) => void;

interface MockSocket {
  connected: boolean;
  emit: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  fire: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, Handler[]>();
  return {
    connected: false,
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: jest.fn((event: string, handler: Handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      );
    }),
    fire: (event, ...args) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    listenerCount: (event) => (handlers.get(event) ?? []).length,
  };
}

const ioMock = jest.mocked(io);
// One socket for the whole file — the hook only ever creates one.
const mockSocket = createMockSocket();
ioMock.mockImplementation(() => mockSocket as unknown as Socket);

describe("useSocket (module singleton — tests are order-dependent)", () => {
  it("creates the singleton with ticket auth on first mount; returns it only after the connect event re-renders", () => {
    const { result } = renderHook(() => useSocket());

    // The socket is created inside the effect, after the first render already
    // returned the (then-null) module value — pinned quirk: the first
    // consumer sees null until the connect event triggers a re-render.
    expect(result.current).toBeNull();

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledWith(
      "http://socket.test",
      expect.objectContaining({
        path: "/api/socketio",
        transports: ["websocket", "polling"],
        autoConnect: true,
        auth: expect.any(Function),
      }),
    );
    expect(createSocketAuthProvider).toHaveBeenCalledWith("terminal");

    act(() => {
      mockSocket.connected = true;
      mockSocket.fire("connect");
    });
    expect(result.current).toBe(mockSocket as unknown as Socket);
  });

  it("later consumers get the existing socket synchronously without a second io() call", () => {
    ioMock.mockClear();

    const { result } = renderHook(() => useSocket());

    expect(result.current).toBe(mockSocket as unknown as Socket);
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("does not disconnect the persistent socket on unmount", () => {
    const { unmount } = renderHook(() => useSocket());

    unmount();

    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    // The creation-time listeners intentionally stay registered for the
    // lifetime of the singleton.
    expect(mockSocket.listenerCount("connect")).toBeGreaterThanOrEqual(1);
  });

  describe("useSocketConnection", () => {
    it("tracks connect/disconnect events and seeds from socket.connected", () => {
      mockSocket.connected = true;
      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.socket).toBe(mockSocket as unknown as Socket);
      expect(result.current.isConnected).toBe(true);

      act(() => {
        mockSocket.connected = false;
        mockSocket.fire("disconnect");
      });
      expect(result.current.isConnected).toBe(false);

      act(() => {
        mockSocket.connected = true;
        mockSocket.fire("connect");
      });
      expect(result.current.isConnected).toBe(true);
    });

    it("removes exactly its own listeners on unmount", () => {
      const connectBefore = mockSocket.listenerCount("connect");
      const disconnectBefore = mockSocket.listenerCount("disconnect");

      const { unmount } = renderHook(() => useSocketConnection());

      expect(mockSocket.listenerCount("connect")).toBe(connectBefore + 1);
      expect(mockSocket.listenerCount("disconnect")).toBe(disconnectBefore + 1);

      unmount();

      expect(mockSocket.listenerCount("connect")).toBe(connectBefore);
      expect(mockSocket.listenerCount("disconnect")).toBe(disconnectBefore);
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });
  });
});
