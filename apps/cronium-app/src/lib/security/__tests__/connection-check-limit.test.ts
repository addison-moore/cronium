/**
 * @jest-environment node
 */
/**
 * The limit on connections to hosts a user chose, on its own, with Valkey's count
 * replaced by one in the test. tests/storage/connection-check-limit.test.ts runs it
 * against real Valkey through the real routes.
 */
const mockValkey = {
  counts: new Map<string, number>(),
  answer: "count" as "count" | "error" | "never",
  asked: 0,
};

jest.mock("@/lib/security/atomic-rate-limiter", () => ({
  consumeAtomicRateLimitOrThrow: (
    identifier: string,
    bucket: string,
    config: { maxRequests: number; windowMs: number },
  ) => {
    mockValkey.asked += 1;
    if (mockValkey.answer === "error") {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
    }
    if (mockValkey.answer === "never") return new Promise(() => undefined);
    const key = `${bucket}:${identifier}`;
    const count = (mockValkey.counts.get(key) ?? 0) + 1;
    mockValkey.counts.set(key, count);
    return Promise.resolve({
      allowed: count <= config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetAt: new Date(Date.now() + 42_000),
    });
  },
}));

import {
  CONNECTION_CHECK_LIMITS,
  ConnectionCheckLimitError,
  resetConnectionCheckLimitsForTests,
  withConnectionCheckLimit,
} from "../connection-check-limit";

const { atOnce, waiting, waitMs, perMinute, valkeyAnswerMs, valkeyRetryMs } =
  CONNECTION_CHECK_LIMITS;

// Every promise chain that isn't waiting on a timer has run by the next turn of the
// event loop.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Checks that run until they're told to finish, recording the order they started. */
function checks() {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const fail = new Map<string, (error: Error) => void>();
  const run = (user: string, name: string) =>
    withConnectionCheckLimit(
      user,
      () =>
        new Promise<string>((resolve, reject) => {
          started.push(name);
          finish.set(name, () => resolve(name));
          fail.set(name, reject);
        }),
    );
  return { started, finish, fail, run };
}

const names = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, n) => `c${from + n}`);

const outcome = (call: Promise<unknown>) =>
  call.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

let errors: jest.SpyInstance;
let warnings: jest.SpyInstance;

beforeEach(() => {
  resetConnectionCheckLimitsForTests();
  mockValkey.counts.clear();
  mockValkey.answer = "count";
  mockValkey.asked = 0;
  errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  errors.mockRestore();
  warnings.mockRestore();
});

describe("at once", () => {
  it(`runs ${atOnce} for a user and starts the rest in order as each finishes`, async () => {
    const { started, finish, run } = checks();
    const calls = names(0, atOnce + 3).map((name) => run("u1", name));
    await settle();
    expect(started).toEqual(names(0, atOnce));

    finish.get("c2")!();
    await settle();
    expect(started).toEqual(names(0, atOnce + 1));

    finish.get("c0")!();
    finish.get("c5")!();
    await settle();
    expect(started).toEqual(names(0, atOnce + 3));

    for (const name of started) finish.get(name)!();
    await expect(Promise.all(calls)).resolves.toEqual(names(0, atOnce + 3));
  });

  it(`refuses at once past ${waiting} waiting, without counting it against the minute`, async () => {
    const { started, finish, run } = checks();
    const accepted = names(0, atOnce + waiting).map((name) => run("u1", name));
    await settle();
    const asked = mockValkey.asked;

    const refused = await outcome(run("u1", "one too many"));
    expect(refused.error).toBeInstanceOf(ConnectionCheckLimitError);
    expect(refused.error).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: `You have ${atOnce} connections to servers or tools being checked and ${waiting} more waiting. Try again once they finish.`,
      retryAfterSeconds: undefined,
    });
    expect(started).not.toContain("one too many");
    expect(mockValkey.asked).toBe(asked);

    // The ones already waiting still get their turn. More than a minute's worth are
    // waiting, so the minute is set aside here for them all to start.
    for (let round = 0; started.length < atOnce + waiting; round += 1) {
      if (round > waiting) throw new Error("The line stopped moving");
      mockValkey.counts.clear();
      for (const name of [...started]) finish.get(name)?.();
      await settle();
    }
    for (const name of started) finish.get(name)!();
    await expect(Promise.all(accepted)).resolves.toHaveLength(atOnce + waiting);
  });

  it(`refuses one that waited ${waitMs / 1000} seconds, and the next in line still gets a turn`, async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
    const { started, finish, run } = checks();
    names(0, atOnce).map((name) => run("u1", name));
    await settle();
    const late = outcome(run("u1", "late"));
    await jest.advanceTimersByTimeAsync(waitMs / 2);
    const later = run("u1", "later");
    await jest.advanceTimersByTimeAsync(waitMs / 2);

    await expect(late).resolves.toMatchObject({
      error: {
        code: "TOO_MANY_REQUESTS",
        message: `You have ${atOnce} connections to servers or tools being checked, and this one waited ${waitMs / 1000} seconds without its turn. Try again once they finish.`,
      },
    });
    finish.get("c0")!();
    await settle();
    expect(started).toEqual([...names(0, atOnce), "later"]);
    finish.get("later")!();
    await expect(later).resolves.toBe("later");
  });

  it("runs another user's checks while one user's are all taken", async () => {
    const { started, finish, run } = checks();
    names(0, atOnce + waiting).map((name) => run("u1", name));
    await settle();
    await expect(outcome(run("u1", "refused"))).resolves.toHaveProperty(
      "error",
    );

    const other = run("u2", "someone else");
    await settle();
    expect(started).toContain("someone else");
    finish.get("someone else")!();
    await expect(other).resolves.toBe("someone else");
  });

  it(`keeps to ${atOnce} at once as a turn passes from one check to the next`, async () => {
    const { started, finish, run } = checks();
    names(0, atOnce + 1).map((name) => run("u1", name));
    await settle();
    finish.get("c0")!();
    await settle();
    expect(started).toEqual(names(0, atOnce + 1));

    // The turn went to the one that was waiting, so these wait too.
    run("u1", "later 1");
    run("u1", "later 2");
    await settle();
    expect(started).toEqual(names(0, atOnce + 1));
    finish.get("c1")!();
    await settle();
    expect(started).toEqual([...names(0, atOnce + 1), "later 1"]);
  });

  it("gives a turn back when the check fails", async () => {
    const { started, fail, run } = checks();
    const calls = names(0, atOnce + 1).map((name) => outcome(run("u1", name)));
    await settle();
    fail.get("c1")!(new Error("connection refused"));
    await settle();
    expect(started).toContain(`c${atOnce}`);
    await expect(calls[1]).resolves.toEqual({
      error: new Error("connection refused"),
    });
  });
});

describe("a minute", () => {
  async function startOneAtATime(user: string, count: number) {
    const results = [];
    for (let n = 0; n < count; n += 1) {
      results.push(
        await outcome(withConnectionCheckLimit(user, () => Promise.resolve(n))),
      );
    }
    return results;
  }

  it(`starts ${perMinute} for a user, says when to try again, and leaves other users alone`, async () => {
    const results = await startOneAtATime("u1", perMinute + 2);
    expect(results.slice(0, perMinute)).toEqual(
      Array.from({ length: perMinute }, (_, value) => ({ value })),
    );
    expect(results[perMinute]).toMatchObject({
      error: {
        code: "TOO_MANY_REQUESTS",
        message: `You can check ${perMinute} connections to servers or tools a minute. Try again in 42 seconds.`,
        retryAfterSeconds: 42,
      },
    });
    expect(results[perMinute]?.error).toBeInstanceOf(ConnectionCheckLimitError);

    await expect(startOneAtATime("u2", 1)).resolves.toEqual([{ value: 0 }]);
  });

  it("frees the turn of a check the minute refused", async () => {
    await startOneAtATime("u1", perMinute);
    const refusals = await Promise.all(
      Array.from({ length: atOnce * 2 }, () =>
        outcome(withConnectionCheckLimit("u1", () => Promise.resolve("ran"))),
      ),
    );
    expect(refusals.every((refusal) => "error" in refusal)).toBe(true);
    mockValkey.counts.clear();
    await expect(startOneAtATime("u1", 1)).resolves.toEqual([{ value: 0 }]);
  });

  it(`counts in this process while Valkey fails, asks again ${valkeyRetryMs / 1000} seconds later, and says so once each way`, async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
    mockValkey.answer = "error";

    const during = await startOneAtATime("u1", perMinute + 1);
    expect(during.slice(0, perMinute).every((r) => "value" in r)).toBe(true);
    expect(during[perMinute]).toMatchObject({
      error: { code: "TOO_MANY_REQUESTS", retryAfterSeconds: 60 },
    });
    // Asked once, then not again until it's time to retry.
    expect(mockValkey.asked).toBe(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]).toEqual([
      "Valkey couldn't count connection checks, so this process counts them by itself until it can:",
      expect.stringContaining("ECONNREFUSED"),
    ]);

    // Still failing when it's asked again: nothing more in the log.
    await jest.advanceTimersByTimeAsync(valkeyRetryMs);
    await startOneAtATime("u1", 1);
    expect(mockValkey.asked).toBe(2);
    expect(errors).toHaveBeenCalledTimes(1);

    mockValkey.answer = "count";
    await jest.advanceTimersByTimeAsync(valkeyRetryMs);
    await expect(startOneAtATime("u1", 1)).resolves.toEqual([{ value: 0 }]);
    expect(mockValkey.asked).toBe(3);
    expect(warnings).toHaveBeenCalledWith(
      "Valkey is counting connection checks again.",
    );
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("starts the count in this process again after a minute", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
    mockValkey.answer = "error";
    await startOneAtATime("u1", perMinute);
    await expect(startOneAtATime("u1", 1)).resolves.toMatchObject([
      { error: { code: "TOO_MANY_REQUESTS" } },
    ]);
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(startOneAtATime("u1", 1)).resolves.toEqual([{ value: 0 }]);
  });

  it(`goes on with this process's count when Valkey says nothing for ${valkeyAnswerMs / 1000} seconds`, async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
    mockValkey.answer = "never";
    let ran = false;
    const call = withConnectionCheckLimit("u1", () => {
      ran = true;
      return Promise.resolve("ran");
    });
    await jest.advanceTimersByTimeAsync(valkeyAnswerMs - 1);
    expect(ran).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toBe("ran");
    expect(errors).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(`no answer within ${valkeyAnswerMs} ms`),
    );

    // Until it's time to ask again, a check doesn't wait on Valkey.
    await expect(
      withConnectionCheckLimit("u1", () => Promise.resolve("at once")),
    ).resolves.toBe("at once");
  });
});
