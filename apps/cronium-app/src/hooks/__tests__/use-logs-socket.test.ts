/**
 * use-logs-socket — the per-user /logs-namespace Socket.IO client.
 *
 * Pins the hook's contract with a scripted socket.io-client mock:
 *   - no connection until an authenticated user is present
 *   - connects to the /logs namespace with a "logs"-audience ticket provider
 *   - subscribe calls made before the socket connects are silently dropped
 *     (they are NOT queued — pinned behavior)
 *   - successful subscriptions are re-established after a reconnect
 *   - log:update fan-out and its cleanup function
 *   - full teardown on unmount (unsubscribe every log, disconnect)
 *   - reconnects with a fresh socket when the user changes
 */
import { act, renderHook } from "@testing-library/react";
import { io, type Socket } from "socket.io-client";

import { useLogsSocket } from "@/hooks/use-logs-socket";
import { useAuth } from "@/hooks/useAuth";
import { createSocketAuthProvider } from "@/lib/socket-ticket-client";

jest.mock("socket.io-client", () => ({
  io: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
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
const mockUseAuth = jest.mocked(useAuth);

function setUser(id: string | null) {
  mockUseAuth.mockReturnValue({
    user: id ? { id } : null,
    isLoading: false,
  } as unknown as ReturnType<typeof useAuth>);
}

describe("useLogsSocket", () => {
  let sockets: MockSocket[];

  beforeEach(() => {
    jest.clearAllMocks();
    sockets = [];
    ioMock.mockImplementation(() => {
      const socket = createMockSocket();
      sockets.push(socket);
      return socket as unknown as Socket;
    });
  });

  function connect(socket: MockSocket) {
    act(() => {
      socket.connected = true;
      socket.fire("connect");
    });
  }

  it("does not connect without an authenticated user", () => {
    setUser(null);

    const { result } = renderHook(() => useLogsSocket());

    expect(ioMock).not.toHaveBeenCalled();
    expect(result.current.socket).toBeNull();
    expect(result.current.isConnected).toBe(false);
    // Guarded no-ops while there is no socket.
    expect(() => result.current.subscribeToLog(1)).not.toThrow();
    expect(result.current.subscribeToLogUpdates(jest.fn())).toBeUndefined();
  });

  it("connects to the /logs namespace with a logs-audience ticket provider once a user exists", () => {
    setUser("user-1");

    const { result } = renderHook(() => useLogsSocket());

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledWith(
      "http://socket.test/logs",
      expect.objectContaining({
        path: "/api/socketio",
        transports: ["websocket", "polling"],
        autoConnect: true,
        auth: expect.any(Function),
      }),
    );
    expect(createSocketAuthProvider).toHaveBeenCalledWith("logs");

    expect(result.current.isConnected).toBe(false);
    connect(sockets[0]!);
    expect(result.current.isConnected).toBe(true);
  });

  it("drops subscribe calls made before the socket has connected (pinned: not queued)", () => {
    setUser("user-1");
    const { result } = renderHook(() => useLogsSocket());
    const socket = sockets[0]!;

    act(() => {
      result.current.subscribeToLog(7);
    });
    expect(socket.emit).not.toHaveBeenCalled();

    // Not queued either: connecting later does not replay the dropped call.
    connect(socket);
    expect(socket.emit).not.toHaveBeenCalledWith("subscribe", { logId: 7 });
  });

  it("subscribes once connected and re-subscribes everything after a reconnect", () => {
    setUser("user-1");
    const { result } = renderHook(() => useLogsSocket());
    const socket = sockets[0]!;
    connect(socket);

    act(() => {
      result.current.subscribeToLog(7);
      result.current.subscribeToLog(8);
    });
    expect(socket.emit).toHaveBeenCalledWith("subscribe", { logId: 7 });
    expect(socket.emit).toHaveBeenCalledWith("subscribe", { logId: 8 });

    act(() => {
      socket.connected = false;
      socket.fire("disconnect");
    });
    expect(result.current.isConnected).toBe(false);

    socket.emit.mockClear();
    connect(socket);
    expect(socket.emit).toHaveBeenCalledWith("subscribe", { logId: 7 });
    expect(socket.emit).toHaveBeenCalledWith("subscribe", { logId: 8 });
  });

  it("unsubscribing emits unsubscribe and stops the id from re-subscribing on reconnect", () => {
    setUser("user-1");
    const { result } = renderHook(() => useLogsSocket());
    const socket = sockets[0]!;
    connect(socket);

    act(() => {
      result.current.subscribeToLog(7);
      result.current.subscribeToLog(8);
      result.current.unsubscribeFromLog(7);
    });
    expect(socket.emit).toHaveBeenCalledWith("unsubscribe", { logId: 7 });

    socket.emit.mockClear();
    act(() => {
      socket.connected = false;
      socket.fire("disconnect");
    });
    connect(socket);

    expect(socket.emit).toHaveBeenCalledWith("subscribe", { logId: 8 });
    expect(socket.emit).not.toHaveBeenCalledWith("subscribe", { logId: 7 });
  });

  it("fans log:update events out to the subscriber and the cleanup deregisters it", () => {
    setUser("user-1");
    const { result } = renderHook(() => useLogsSocket());
    const socket = sockets[0]!;
    connect(socket);

    const onUpdate = jest.fn();
    let cleanup: (() => void) | undefined;
    act(() => {
      cleanup = result.current.subscribeToLogUpdates(onUpdate);
    });

    const update = { logId: 42, status: "success", output: "done" };
    act(() => {
      socket.fire("log:update", update);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(update);

    act(() => {
      cleanup?.();
      socket.fire("log:update", update);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(socket.listenerCount("log:update")).toBe(0);
  });

  it("tears down on unmount: unsubscribes every subscribed log and disconnects", () => {
    setUser("user-1");
    const { result, unmount } = renderHook(() => useLogsSocket());
    const socket = sockets[0]!;
    connect(socket);

    act(() => {
      result.current.subscribeToLog(7);
      result.current.subscribeToLog(8);
    });
    socket.emit.mockClear();

    unmount();

    expect(socket.emit).toHaveBeenCalledWith("unsubscribe", { logId: 7 });
    expect(socket.emit).toHaveBeenCalledWith("unsubscribe", { logId: 8 });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("replaces the socket when the user changes", () => {
    setUser("user-1");
    const { rerender } = renderHook(() => useLogsSocket());
    const first = sockets[0]!;
    connect(first);

    setUser("user-2");
    rerender();

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });
});
