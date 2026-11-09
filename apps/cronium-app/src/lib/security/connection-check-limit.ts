import { TRPCError } from "@trpc/server";
import { describeFailure } from "@/lib/pg-errors";
import { consumeAtomicRateLimitOrThrow } from "@/lib/security/atomic-rate-limiter";

/**
 * A limit for each user on connections to hosts they chose: testing, adding or
 * re-keying a server, its health check, and testing a tool. Each opens a socket to
 * wherever the user typed. Without a limit one signed-in user could open thousands at
 * once: 5,000 held 3,421 file descriptors, and a process allowed 1,024 ran out at about
 * 1,000. Each answer also says whether something listens at that address, from the
 * app's own network.
 *
 * Two limits, because each does what the other can't:
 *
 * - **At once, in this process.** At most `atOnce` run for a user. Up to `waiting` more
 *   wait their turn, in order, for at most `waitMs`, which is what lets the Tools page
 *   test every tool it lists when it opens. Past that a call is refused at once. Nothing
 *   outside the process is asked, so this holds whatever else is down, and it's what
 *   bounds the sockets.
 * - **Started a minute.** At most `perMinute` start for a user, counted atomically in
 *   Valkey so calls made at the same moment can't get past it, as they do withRateLimit,
 *   and so every app process shares the count. It's what makes the routes a slow probe.
 *   When Valkey doesn't answer within `valkeyAnswerMs`, this process counts by itself and
 *   asks Valkey again `valkeyRetryMs` later. Sign-in refuses everyone instead, but here
 *   that would stop every server and tool check while Valkey is down, and a count in the
 *   process is the same limit on a single app process.
 *
 * A call that waits counts against the minute only once it starts, so calls refused for
 * being too many at once cost nothing.
 */
export const CONNECTION_CHECK_LIMITS = {
  atOnce: 8,
  waiting: 64,
  waitMs: 15_000,
  perMinute: 60,
  valkeyAnswerMs: 2_000,
  valkeyRetryMs: 10_000,
} as const;

const MINUTE_MS = 60_000;
const BUCKET = "connection-checks";

export class ConnectionCheckLimitError extends TRPCError {
  /** When the minute's count starts again, if that's the limit reached. */
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number) {
    super({ code: "TOO_MANY_REQUESTS", message });
    this.name = "ConnectionCheckLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * What a REST route answers when a check was refused. A plain Response, so the routers
 * importing this module don't load next/server.
 */
export function connectionCheckLimitResponse(
  error: ConnectionCheckLimitError,
): Response {
  return Response.json(
    { error: "Too many connection checks", message: error.message },
    error.retryAfterSeconds === undefined
      ? { status: 429 }
      : {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
  );
}

interface Turn {
  start: () => void;
  timer: NodeJS.Timeout;
}

interface UserTurns {
  running: number;
  waiting: Turn[];
}

interface CountHere {
  started: number;
  resetAt: number;
}

interface LimitState {
  turns: Map<string, UserTurns>;
  countsHere: Map<string, CountHere>;
  valkeyDown: boolean;
  askValkeyAt: number;
}

// On globalThis, so every copy a bundler makes of this module shares one count.
const STATE = Symbol.for("cronium.connectionCheckLimit");

function state(): LimitState {
  const holder = globalThis as typeof globalThis & { [STATE]?: LimitState };
  holder[STATE] ??= {
    turns: new Map(),
    countsHere: new Map(),
    valkeyDown: false,
    askValkeyAt: 0,
  };
  return holder[STATE];
}

const checks = (n: number) =>
  `${n} connection${n === 1 ? "" : "s"} to servers or tools`;

const secondsUntil = (time: number) =>
  Math.max(1, Math.ceil((time - Date.now()) / 1000));

async function takeTurn(userId: string): Promise<void> {
  const { atOnce, waiting, waitMs } = CONNECTION_CHECK_LIMITS;
  const { turns } = state();
  let mine = turns.get(userId);
  if (!mine) {
    mine = { running: 0, waiting: [] };
    turns.set(userId, mine);
  }
  if (mine.running < atOnce) {
    mine.running += 1;
    return;
  }
  if (mine.waiting.length >= waiting) {
    throw new ConnectionCheckLimitError(
      `You have ${checks(atOnce)} being checked and ${waiting} more waiting. Try again once they finish.`,
    );
  }
  const line = mine.waiting;
  await new Promise<void>((start, refuse) => {
    const turn: Turn = {
      start,
      timer: setTimeout(() => {
        const at = line.indexOf(turn);
        if (at !== -1) line.splice(at, 1);
        refuse(
          new ConnectionCheckLimitError(
            `You have ${checks(atOnce)} being checked, and this one waited ${waitMs / 1000} seconds without its turn. Try again once they finish.`,
          ),
        );
      }, waitMs),
    };
    // A waiting check mustn't keep a process, or a test, alive by itself.
    turn.timer.unref();
    line.push(turn);
  });
}

function passTurn(userId: string): void {
  const { turns } = state();
  const mine = turns.get(userId);
  if (!mine) return;
  // Straight to the next in line, so a call arriving now can't take it first.
  const next = mine.waiting.shift();
  if (next) {
    clearTimeout(next.timer);
    next.start();
    return;
  }
  mine.running -= 1;
  if (mine.running === 0) turns.delete(userId);
}

async function withinMs<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer within ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function countHere(userId: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const { countsHere } = state();
  const now = Date.now();
  let count = countsHere.get(userId);
  if (!count || count.resetAt <= now) {
    for (const [id, old] of countsHere) {
      if (old.resetAt <= now) countsHere.delete(id);
    }
    count = { started: 0, resetAt: now + MINUTE_MS };
    countsHere.set(userId, count);
  }
  count.started += 1;
  return {
    allowed: count.started <= CONNECTION_CHECK_LIMITS.perMinute,
    retryAfterSeconds: secondsUntil(count.resetAt),
  };
}

async function startOneThisMinute(userId: string): Promise<{
  allowed: boolean;
  retryAfterSeconds: number;
}> {
  const { perMinute, valkeyAnswerMs, valkeyRetryMs } = CONNECTION_CHECK_LIMITS;
  const shared = state();
  if (!shared.valkeyDown || Date.now() >= shared.askValkeyAt) {
    try {
      const { allowed, resetAt } = await withinMs(
        consumeAtomicRateLimitOrThrow(userId, BUCKET, {
          maxRequests: perMinute,
          windowMs: MINUTE_MS,
        }),
        valkeyAnswerMs,
      );
      if (shared.valkeyDown) {
        shared.valkeyDown = false;
        console.warn("Valkey is counting connection checks again.");
      }
      return { allowed, retryAfterSeconds: secondsUntil(resetAt.getTime()) };
    } catch (error) {
      if (!shared.valkeyDown) {
        console.error(
          "Valkey couldn't count connection checks, so this process counts them by itself until it can:",
          describeFailure(error),
        );
      }
      shared.valkeyDown = true;
      shared.askValkeyAt = Date.now() + valkeyRetryMs;
    }
  }
  return countHere(userId);
}

/**
 * Runs `connect`, which connects to a host that `userId` chose, within that user's
 * limits. Throws ConnectionCheckLimitError without running it when a limit is reached,
 * so a caller can tell that apart from an answer about the host.
 */
export async function withConnectionCheckLimit<T>(
  userId: string,
  connect: () => Promise<T>,
): Promise<T> {
  await takeTurn(userId);
  try {
    const { allowed, retryAfterSeconds } = await startOneThisMinute(userId);
    if (!allowed) {
      throw new ConnectionCheckLimitError(
        `You can check ${checks(CONNECTION_CHECK_LIMITS.perMinute)} a minute. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
        retryAfterSeconds,
      );
    }
    return await connect();
  } finally {
    passTurn(userId);
  }
}

/** Forgets every count and turn in this process. Only tests need this. */
export function resetConnectionCheckLimitsForTests(): void {
  const shared = state();
  for (const mine of shared.turns.values()) {
    for (const turn of mine.waiting) clearTimeout(turn.timer);
  }
  shared.turns.clear();
  shared.countsHere.clear();
  shared.valkeyDown = false;
  shared.askValkeyAt = 0;
}
