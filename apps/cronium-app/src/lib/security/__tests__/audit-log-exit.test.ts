/**
 * @jest-environment node
 */
/**
 * What holds the Next server open for the audit log's last write. A real Next
 * being stopped is in tests/e2e/audit-log-stop.test.ts; this covers the timing.
 */

jest.mock("../audit-logger", () => ({
  auditLogger: {
    flush: jest.fn(() => Promise.resolve()),
    shutdown: jest.fn(),
  },
}));

import { auditLogger } from "../audit-logger";
import {
  flushAuditLogBeforeExit,
  REQUEST_DRAIN_LIMIT_MS,
} from "../audit-log-exit";

const shutdown = auditLogger.shutdown as jest.Mock;
const flush = auditLogger.flush as jest.Mock;

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("flushAuditLogBeforeExit", () => {
  const realExit = process.exit;
  let exit: jest.Mock;
  let finishShutdown: () => void;
  let listeners: Map<string, unknown[]>;

  const signals = ["SIGTERM", "SIGINT"] as const;

  /** process.emit doesn't reach listeners on the process Jest gives a test. */
  const receive = (signal: (typeof signals)[number]) => {
    for (const listener of process.listeners(signal)) {
      if (!listeners.get(signal)!.includes(listener)) {
        (listener as (signal: string) => void)(signal);
      }
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    exit = jest.fn();
    process.exit = exit as unknown as typeof process.exit;
    shutdown.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve;
        }),
    );
    listeners = new Map(signals.map((s) => [s, process.listeners(s)]));

    flushAuditLogBeforeExit();
  });

  afterEach(() => {
    jest.useRealTimers();
    process.exit = realExit;
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!listeners.get(signal)!.includes(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
  });

  it("leaves process.exit alone until a signal arrives", () => {
    expect(process.exit).toBe(exit);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("writes what's already logged as soon as the signal arrives", () => {
    receive("SIGTERM");

    expect(flush).toHaveBeenCalledTimes(1);
    // Later requests can still log entries, so this isn't the last write.
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("holds Next's exit until the log is written, then exits with Next's code", async () => {
    receive("SIGTERM");

    process.exit(143);
    await settle();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    finishShutdown();
    await settle();
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("still exits if writing the log fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation();
    shutdown.mockRejectedValue(new Error("no"));
    receive("SIGTERM");

    process.exit(143);
    await settle();

    expect(exit).toHaveBeenCalledWith(143);
    errorSpy.mockRestore();
  });

  it("writes the log only once, however many times exit is called", async () => {
    receive("SIGTERM");

    process.exit(143);
    process.exit(1);
    await settle();
    expect(shutdown).toHaveBeenCalledTimes(1);

    finishShutdown();
    await settle();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("stops waiting for requests after the limit, and exits as Next would", async () => {
    receive("SIGTERM");

    jest.advanceTimersByTime(REQUEST_DRAIN_LIMIT_MS - 1);
    expect(shutdown).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    finishShutdown();
    await settle();
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("exits as Next would for SIGINT too", async () => {
    receive("SIGINT");

    jest.advanceTimersByTime(REQUEST_DRAIN_LIMIT_MS);
    finishShutdown();
    await settle();

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("ignores a second signal", async () => {
    // start.sh signals again once either server has exited, and a shell can too.
    receive("SIGTERM");
    receive("SIGTERM");
    receive("SIGINT");
    expect(flush).toHaveBeenCalledTimes(1);

    process.exit(143);
    finishShutdown();
    await settle();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
