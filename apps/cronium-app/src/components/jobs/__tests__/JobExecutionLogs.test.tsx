/**
 * JobExecutionLogs — the socket-fed live log viewer.
 *
 * The socket layer is replaced by a scripted fake (via the @/hooks/use-socket
 * factory mock); tests pin the component's observable contract:
 *   - joins/leaves the per-job log room and cleans up its listeners
 *   - renders incoming lines in arrival order (no sorting, no dedup)
 *   - ignores lines addressed to other jobs
 *   - always follows the stream (scrolls the Radix viewport to the bottom on
 *     every new line — there is no scroll-up-pauses-following behavior)
 *   - reflects connect/disconnect in the status badge
 *   - resets the buffer when the jobId prop changes (App Router reuses the
 *     page instance across dynamic-param navigations)
 */
import { act, render, screen } from "@testing-library/react";
import type { Socket } from "socket.io-client";

import { JobExecutionLogs } from "@/components/jobs/JobExecutionLogs";
import { useSocket } from "@/hooks/use-socket";

jest.mock("@/hooks/use-socket", () => ({
  useSocket: jest.fn(),
}));

const mockUseSocket = jest.mocked(useSocket);

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

function createMockSocket(connected = true): MockSocket {
  const handlers = new Map<string, Handler[]>();
  return {
    connected,
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

function asSocket(socket: MockSocket): Socket {
  return socket as unknown as Socket;
}

function logLine(
  jobId: string,
  line: string,
  stream: "stdout" | "stderr" = "stdout",
  timestamp = "2026-07-25T12:00:00.000Z",
) {
  return { jobId, line, stream, timestamp };
}

function getViewport(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector<HTMLElement>(
    "[data-radix-scroll-area-viewport]",
  );
  if (!viewport) throw new Error("Radix ScrollArea viewport not rendered");
  return viewport;
}

describe("JobExecutionLogs", () => {
  let socket: MockSocket;

  beforeEach(() => {
    jest.clearAllMocks();
    socket = createMockSocket();
    mockUseSocket.mockReturnValue(asSocket(socket));
  });

  it("joins the job's log room on mount and shows the waiting placeholder", () => {
    render(<JobExecutionLogs jobId="job-1" />);

    expect(socket.emit).toHaveBeenCalledWith("join:log", { jobId: "job-1" });
    expect(screen.getByText("Waiting for logs...")).toBeInTheDocument();
  });

  it("renders incoming lines in arrival order", () => {
    const { container } = render(<JobExecutionLogs jobId="job-1" />);

    act(() => {
      socket.fire("log:line", logLine("job-1", "alpha line"));
      socket.fire("log:line", logLine("job-1", "beta line"));
      socket.fire("log:line", logLine("job-1", "gamma line"));
    });

    const text = getViewport(container).textContent ?? "";
    expect(text.indexOf("alpha line")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("alpha line")).toBeLessThan(text.indexOf("beta line"));
    expect(text.indexOf("beta line")).toBeLessThan(text.indexOf("gamma line"));
    expect(screen.queryByText("Waiting for logs...")).not.toBeInTheDocument();
  });

  it("appends out-of-order timestamps in arrival order (no re-sorting)", () => {
    const { container } = render(<JobExecutionLogs jobId="job-1" />);

    act(() => {
      socket.fire(
        "log:line",
        logLine("job-1", "later stamp", "stdout", "2026-07-25T12:00:09.000Z"),
      );
      socket.fire(
        "log:line",
        logLine("job-1", "earlier stamp", "stdout", "2026-07-25T12:00:01.000Z"),
      );
    });

    const text = getViewport(container).textContent ?? "";
    expect(text.indexOf("later stamp")).toBeLessThan(
      text.indexOf("earlier stamp"),
    );
  });

  it("renders duplicate events twice (no deduplication)", () => {
    render(<JobExecutionLogs jobId="job-1" />);

    const payload = logLine("job-1", "dup line");
    act(() => {
      socket.fire("log:line", payload);
      socket.fire("log:line", payload);
    });

    expect(screen.getAllByText("dup line")).toHaveLength(2);
  });

  it("ignores lines addressed to a different job", () => {
    render(<JobExecutionLogs jobId="job-1" />);

    act(() => {
      socket.fire("log:line", logLine("job-2", "foreign line"));
    });

    expect(screen.queryByText("foreign line")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for logs...")).toBeInTheDocument();
  });

  it("styles stderr lines as destructive and stdout lines as success", () => {
    render(<JobExecutionLogs jobId="job-1" />);

    act(() => {
      socket.fire("log:line", logLine("job-1", "out line", "stdout"));
      socket.fire("log:line", logLine("job-1", "err line", "stderr"));
    });

    expect(screen.getByText("out line")).toHaveClass("text-success");
    expect(screen.getByText("err line")).toHaveClass("text-destructive");
  });

  it("scrolls the ScrollArea viewport to the bottom on every new line, even after a user scrolled up", () => {
    const { container } = render(<JobExecutionLogs jobId="job-1" />);
    const viewport = getViewport(container);

    // jsdom has no layout; instrument the scroll properties the code uses.
    // Regression guard for the autoscroll fix: the code must scroll the
    // Radix *viewport* (the real scroll container), not the clipping Root.
    const scrollTopWrites: number[] = [];
    let scrollHeight = 1234;
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => 0,
      set: (value: number) => {
        scrollTopWrites.push(value);
      },
    });

    act(() => {
      socket.fire("log:line", logLine("job-1", "first"));
    });
    expect(scrollTopWrites).toContain(1234);

    // Simulate more content and a second line; the component keeps following
    // the stream unconditionally (there is no pause-when-scrolled-up state).
    scrollHeight = 5678;
    act(() => {
      socket.fire("log:line", logLine("job-1", "second"));
    });
    expect(scrollTopWrites[scrollTopWrites.length - 1]).toBe(5678);
  });

  it("reflects the socket connection state in the status badge", () => {
    render(<JobExecutionLogs jobId="job-1" />);

    // Initial state comes from socket.connected (true in this fixture).
    expect(screen.getByText("Connected")).toBeInTheDocument();

    act(() => {
      socket.fire("disconnect");
    });
    expect(screen.getByText("Disconnected")).toBeInTheDocument();

    act(() => {
      socket.fire("connect");
    });
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("starts disconnected when the socket is not yet connected", () => {
    socket = createMockSocket(false);
    mockUseSocket.mockReturnValue(asSocket(socket));

    render(<JobExecutionLogs jobId="job-1" />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("switching jobs leaves the old room, joins the new one, and clears the buffer", () => {
    const { rerender } = render(<JobExecutionLogs jobId="job-1" />);

    act(() => {
      socket.fire("log:line", logLine("job-1", "old job line"));
    });
    expect(screen.getByText("old job line")).toBeInTheDocument();

    socket.emit.mockClear();
    rerender(<JobExecutionLogs jobId="job-2" />);

    expect(socket.emit).toHaveBeenCalledWith("leave:log", { jobId: "job-1" });
    expect(socket.emit).toHaveBeenCalledWith("join:log", { jobId: "job-2" });
    // Regression guard: the previous job's lines must not linger (the App
    // Router reuses the page instance across param changes).
    expect(screen.queryByText("old job line")).not.toBeInTheDocument();

    act(() => {
      socket.fire("log:line", logLine("job-2", "new job line"));
    });
    expect(screen.getByText("new job line")).toBeInTheDocument();
    expect(screen.queryByText("old job line")).not.toBeInTheDocument();
  });

  it("on unmount leaves the room and removes exactly its listeners without disconnecting the shared socket", () => {
    const { unmount } = render(<JobExecutionLogs jobId="job-1" />);

    expect(socket.listenerCount("log:line")).toBe(1);
    expect(socket.listenerCount("connect")).toBe(1);
    expect(socket.listenerCount("disconnect")).toBe(1);

    unmount();

    expect(socket.emit).toHaveBeenCalledWith("leave:log", { jobId: "job-1" });
    expect(socket.listenerCount("log:line")).toBe(0);
    expect(socket.listenerCount("connect")).toBe(0);
    expect(socket.listenerCount("disconnect")).toBe(0);
    // The socket is a shared singleton — unmounting a viewer must not close it.
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it("does nothing when the socket is not available yet", () => {
    mockUseSocket.mockReturnValue(null);

    render(<JobExecutionLogs jobId="job-1" />);

    expect(screen.getByText("Waiting for logs...")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});
