/**
 * Terminal — xterm-based remote terminal with connect gating.
 *
 * xterm (and its addons) and the terminal socket manager are fully mocked;
 * fake timers drive the component's 500ms init delay. Pinned contract:
 *   - NO socket is requested until the gate passes (client-mounted, container
 *     rendered, auth resolved, user present)
 *   - once gated in, exactly one getSocket(serverId) call and one
 *     create-terminal request with the terminal's dimensions
 *   - existing / in-flight sessions are never double-created
 *   - unmount tears everything down: timer cleared, terminal disposed, this
 *     component's listeners removed from the singleton socket — but the
 *     socket itself stays connected (singleton-managed)
 */
import { act, render, screen } from "@testing-library/react";
import type { Socket } from "socket.io-client";

import Terminal from "@/components/terminal/Terminal";
import { useAuth } from "@/hooks/useAuth";
import { terminalSocketManager } from "@/lib/terminal-socket-manager";

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/terminal-socket-manager", () => ({
  terminalSocketManager: {
    getSocket: jest.fn(),
    getSessionId: jest.fn(),
    setSessionId: jest.fn(),
    isCreatingSession: jest.fn(),
    setCreatingSession: jest.fn(),
    cleanup: jest.fn(),
    isConnected: jest.fn(),
  },
}));

// xterm and addons are loaded via dynamic import() inside the component;
// jest resolves those to these mocks. Instances are tracked on mock-prefixed
// registries so tests can reach the created terminal.
const mockXtermInstances: MockXTerm[] = [];
const mockFitInstances: MockFitAddon[] = [];

class MockXTerm {
  cols = 120;
  rows = 30;
  unicode = { activeVersion: "6" };
  open = jest.fn();
  write = jest.fn();
  loadAddon = jest.fn();
  dispose = jest.fn();
  onDataCallback: ((data: string) => void) | null = null;
  onData = jest.fn((callback: (data: string) => void) => {
    this.onDataCallback = callback;
  });

  constructor() {
    mockXtermInstances.push(this);
  }
}

class MockFitAddon {
  fit = jest.fn();

  constructor() {
    mockFitInstances.push(this);
  }
}

jest.mock("@xterm/xterm", () => ({ Terminal: MockXTerm }));
jest.mock("@xterm/addon-fit", () => ({ FitAddon: MockFitAddon }));
jest.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
jest.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

type Handler = (...args: unknown[]) => void;

interface MockSocket {
  connected: boolean;
  emit: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
  removeAllListeners: jest.Mock;
  fire: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, Handler[]>();
  return {
    connected: true,
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    removeAllListeners: jest.fn((event: string) => {
      handlers.delete(event);
    }),
    fire: (event, ...args) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    listenerCount: (event) => (handlers.get(event) ?? []).length,
  };
}

const mockUseAuth = jest.mocked(useAuth);
const manager = jest.mocked(terminalSocketManager);

function setAuth(userId: string | null, isLoading: boolean) {
  mockUseAuth.mockReturnValue({
    user: userId ? { id: userId } : null,
    isLoading,
  } as unknown as ReturnType<typeof useAuth>);
}

/** Drain chained microtasks (dynamic imports, getSocket promise) inside act. */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

async function fireInitTimer() {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await flushAsync();
}

describe("Terminal", () => {
  let socket: MockSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockXtermInstances.length = 0;
    mockFitInstances.length = 0;

    socket = createMockSocket();
    manager.getSocket.mockResolvedValue(socket as unknown as Socket);
    manager.getSessionId.mockReturnValue(null);
    manager.isCreatingSession.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function mountReady() {
    setAuth("user-1", false);
    const view = render(<Terminal serverId={6} serverName="Sandbox Six" />);
    await fireInitTimer();
    return view;
  }

  describe("connect gating", () => {
    it("does not request a socket while auth is loading", async () => {
      setAuth(null, true);
      render(<Terminal serverId={6} serverName="Sandbox Six" />);

      expect(screen.getByText("Loading terminal...")).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await flushAsync();

      expect(manager.getSocket).not.toHaveBeenCalled();
      expect(mockXtermInstances).toHaveLength(0);
    });

    it("does not request a socket when there is no authenticated user", async () => {
      setAuth(null, false);
      render(<Terminal serverId={6} serverName="Sandbox Six" />);

      // Auth has resolved, so the container renders — but the gate must
      // still block: no user, no connection.
      expect(screen.queryByText("Loading terminal...")).not.toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await flushAsync();

      expect(manager.getSocket).not.toHaveBeenCalled();
      expect(mockXtermInstances).toHaveLength(0);
    });

    it("connects exactly once, only after the 500ms init delay, with the selected server id", async () => {
      setAuth("user-1", false);
      render(<Terminal serverId={6} serverName="Sandbox Six" />);

      // Gate passed but the init delay has not elapsed — still no connect.
      expect(manager.getSocket).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(499);
      });
      await flushAsync();
      expect(manager.getSocket).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      await flushAsync();

      expect(manager.getSocket).toHaveBeenCalledTimes(1);
      expect(manager.getSocket).toHaveBeenCalledWith(6);

      // The terminal opened into its container and was fitted.
      expect(mockXtermInstances).toHaveLength(1);
      const term = mockXtermInstances[0]!;
      expect(term.open).toHaveBeenCalledTimes(1);
      expect(term.unicode.activeVersion).toBe("11");
      expect(mockFitInstances[0]!.fit).toHaveBeenCalled();
    });

    it("never connects when unmounted before the init delay fires", async () => {
      setAuth("user-1", false);
      const { unmount } = render(
        <Terminal serverId={6} serverName="Sandbox Six" />,
      );

      unmount();
      await act(async () => {
        jest.advanceTimersByTime(2_000);
      });
      await flushAsync();

      expect(manager.getSocket).not.toHaveBeenCalled();
      expect(mockXtermInstances).toHaveLength(0);
    });

    it("aborts wiring when unmounted while the socket connection is pending", async () => {
      let resolveSocket: (value: Socket) => void = () => undefined;
      manager.getSocket.mockReturnValue(
        new Promise<Socket>((resolve) => {
          resolveSocket = resolve;
        }),
      );

      setAuth("user-1", false);
      const { unmount } = render(
        <Terminal serverId={6} serverName="Sandbox Six" />,
      );
      await fireInitTimer();
      expect(manager.getSocket).toHaveBeenCalledTimes(1);

      unmount();
      resolveSocket(socket as unknown as Socket);
      await flushAsync();

      // The late socket must not be wired up or asked to create a session.
      expect(socket.on).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled();
      // The terminal created during init was disposed by the unmount.
      expect(mockXtermInstances[0]!.dispose).toHaveBeenCalled();
    });
  });

  describe("session creation", () => {
    it("requests a new session with the terminal's dimensions when none exists", async () => {
      await mountReady();

      expect(manager.setCreatingSession).toHaveBeenCalledWith(true);
      expect(socket.emit).toHaveBeenCalledTimes(1);
      expect(socket.emit).toHaveBeenCalledWith("create-terminal", {
        serverId: 6,
        cols: 120,
        rows: 30,
      });
      // Connecting indicator shows until the session is confirmed.
      expect(screen.getByText("Connecting...")).toBeInTheDocument();
    });

    it("reuses an existing session instead of creating another", async () => {
      manager.getSessionId.mockReturnValue("sess-1");

      await mountReady();

      expect(socket.emit).not.toHaveBeenCalledWith(
        "create-terminal",
        expect.anything(),
      );
      expect(manager.setCreatingSession).not.toHaveBeenCalledWith(true);
      expect(screen.queryByText("Connecting...")).not.toBeInTheDocument();
    });

    it("does not double-request while another mount is already creating a session", async () => {
      manager.isCreatingSession.mockReturnValue(true);

      await mountReady();

      expect(socket.emit).not.toHaveBeenCalledWith(
        "create-terminal",
        expect.anything(),
      );
    });

    it("stores the session id and greets on terminal-created", async () => {
      await mountReady();
      const term = mockXtermInstances[0]!;

      act(() => {
        socket.fire("terminal-created", { sessionId: "sess-9" });
      });

      expect(manager.setSessionId).toHaveBeenCalledWith("sess-9");
      expect(manager.setCreatingSession).toHaveBeenCalledWith(false);
      expect(term.write).toHaveBeenCalledWith(
        expect.stringContaining("Sandbox Six"),
      );
      expect(screen.queryByText("Connecting...")).not.toBeInTheDocument();
    });
  });

  describe("session I/O", () => {
    it("writes terminal-output data through to xterm", async () => {
      await mountReady();
      const term = mockXtermInstances[0]!;

      act(() => {
        socket.fire("terminal-output", { data: "hello from pty" });
      });

      expect(term.write).toHaveBeenCalledWith("hello from pty");
    });

    it("forwards keyboard input tagged with the current session id", async () => {
      await mountReady();
      const term = mockXtermInstances[0]!;
      manager.getSessionId.mockReturnValue("sess-1");

      act(() => {
        term.onDataCallback?.("ls -la\r");
      });

      expect(socket.emit).toHaveBeenCalledWith("terminal-input", {
        sessionId: "sess-1",
        input: "ls -la\r",
      });
    });

    it("drops keyboard input when there is no session yet", async () => {
      await mountReady();
      const term = mockXtermInstances[0]!;
      socket.emit.mockClear();
      manager.getSessionId.mockReturnValue(null);

      act(() => {
        term.onDataCallback?.("echo hi\r");
      });

      expect(socket.emit).not.toHaveBeenCalled();
    });

    it("refits and reports new dimensions on window resize", async () => {
      await mountReady();
      const fitAddon = mockFitInstances[0]!;
      manager.getSessionId.mockReturnValue("sess-1");
      fitAddon.fit.mockClear();

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(fitAddon.fit).toHaveBeenCalledTimes(1);
      expect(socket.emit).toHaveBeenCalledWith("terminal-resize", {
        sessionId: "sess-1",
        cols: 120,
        rows: 30,
      });
    });

    it("announces process exit and clears the session id", async () => {
      await mountReady();
      const term = mockXtermInstances[0]!;

      act(() => {
        socket.fire("terminal-exit", { exitCode: 3 });
      });

      expect(term.write).toHaveBeenCalledWith(
        expect.stringContaining("[Process exited with code 3]"),
      );
      expect(manager.setSessionId).toHaveBeenCalledWith(null);
    });
  });

  describe("teardown", () => {
    it("disposes the terminal and removes its socket listeners, but keeps the singleton socket connected", async () => {
      const { unmount } = await mountReady();
      const term = mockXtermInstances[0]!;
      expect(socket.listenerCount("terminal-output")).toBe(1);

      unmount();

      expect(term.dispose).toHaveBeenCalledTimes(1);
      // Regression guard (listener-leak fix): this component's handlers must
      // come off the long-lived socket on unmount — they close over the
      // disposed terminal.
      for (const event of [
        "terminal-created",
        "terminal-output",
        "terminal-exit",
        "terminal-error",
      ]) {
        expect(socket.listenerCount(event)).toBe(0);
      }
      // The socket itself is singleton-managed and must stay open for reuse.
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it("removes the window resize listener on unmount", async () => {
      const { unmount } = await mountReady();
      const fitAddon = mockFitInstances[0]!;

      unmount();
      fitAddon.fit.mockClear();

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(fitAddon.fit).not.toHaveBeenCalled();
    });
  });
});
