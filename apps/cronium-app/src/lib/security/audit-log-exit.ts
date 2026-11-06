/**
 * Keeps the Next server alive for the audit log's last write. Every credential
 * change is logged here, and it sits in the logger's buffer for up to five seconds.
 *
 * Next handles SIGTERM and SIGINT itself: it stops accepting connections, finishes
 * the requests in flight, then calls process.exit, within milliseconds if nothing
 * is in flight. It has no hook for anything to run in between, and the right place
 * is there, because those last requests can log entries too. So once a signal has
 * arrived, process.exit waits for the logger.
 */
import { failureWithStack } from "@/lib/pg-errors";
import { auditLogger } from "./audit-logger";

/**
 * How long Next gets to finish requests before the log is written regardless. It
 * sets no limit of its own, and on a hung database a request never finishes.
 * Compose's stop_grace_period for the app has to leave room for this and for
 * AuditLogger.shutdown().
 */
export const REQUEST_DRAIN_LIMIT_MS = 10_000;

/** What Next exits with, for when it doesn't get that far. */
const EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

function logFailedWrite(error: unknown): void {
  console.error(
    "[AuditLog] Writing the last entries failed:",
    failureWithStack(error),
  );
}

export function flushAuditLogBeforeExit(): void {
  let stopping = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;

    const exit = process.exit.bind(process);
    let exiting = false;
    const writeLogThenExit = (code?: Parameters<typeof process.exit>[0]) => {
      if (exiting) return;
      exiting = true;
      void auditLogger
        .shutdown()
        .catch(logFailedWrite)
        .finally(() => exit(code));
    };

    process.exit = (code) => {
      writeLogThenExit(code);
      return undefined as never;
    };

    setTimeout(
      () => writeLogThenExit(EXIT_CODES[signal]),
      REQUEST_DRAIN_LIMIT_MS,
    ).unref();

    // Requests can outlast whatever is left of the grace period, and what they
    // wait on is no reason to risk what has already been logged.
    auditLogger.flush().catch(logFailedWrite);
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}
