/**
 * How long a Valkey command may go unanswered before its client gives up on it, and on
 * the connection it was sent on.
 *
 * A Valkey that accepts connections and never answers, as when its container is paused
 * or a network drops packets without closing the TCP connection, otherwise holds every
 * command for good. ioredis has no limit of its own, and nothing closes a connection that
 * has only gone quiet. Measured on 2026-11-09 with Valkey paused, a signed-in tRPC call
 * made no progress in 8 minutes, and REST calls and sign-in waited the same way.
 *
 * - `commandTimeout` rejects a command with "Command timed out" once it has waited this
 *   long, whether it was sent or is queued for a connection being made.
 * - `socketTimeout` closes a connection that was sent a command and has said nothing for
 *   as long, and ioredis connects again. Without it each later command is written to the
 *   same silent connection, waits out its own limit, and stays queued in memory until a
 *   reply comes, which after a partition can be when TCP gives up, 15 minutes on Linux.
 * - `autoResendUnfulfilledCommands: false`: what was waiting on that connection isn't
 *   sent again on the next one. Its caller has been told it failed, or soon will be, so
 *   resending would spend a single-use code taken with GETDEL, or count a sign-in
 *   attempt, after the caller had moved on.
 *
 * Valkey answers in well under a millisecond, so two seconds is reached only when it
 * isn't answering, or when this process's event loop was blocked for that long.
 */
export const VALKEY_ANSWER_MS = 2_000;

export const VALKEY_ANSWER_LIMITS = {
  commandTimeout: VALKEY_ANSWER_MS,
  socketTimeout: VALKEY_ANSWER_MS,
  autoResendUnfulfilledCommands: false,
} as const;
