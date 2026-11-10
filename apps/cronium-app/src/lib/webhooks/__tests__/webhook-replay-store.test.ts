/**
 * @jest-environment node
 */
// What the delivery id check sends Valkey, with a client whose state and answers the
// tests set. tests/storage/webhook-delivery-id-outage.test.ts has a real Valkey going
// away through the real route. These cover what that can't see from outside: what's
// sent, and which stranded claims each check carries.
jest.mock("ioredis", () => {
  const client = {
    status: "ready",
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue("PONG"),
    eval: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  };
  return {
    __esModule: true,
    default: jest.fn(() => client),
    mockClient: client,
  };
});

import { randomUUID } from "crypto";
import {
  ANSWER_TIMEOUT_MS,
  consumeWebhookDeliveryOnce,
  type DeliveryClaim,
  releaseWebhookDelivery,
} from "../webhook-replay-store";

interface FakeClient {
  status: string;
  connect: jest.Mock;
  eval: jest.Mock;
}

const { mockClient: valkey } = jest.requireMock("ioredis") as {
  mockClient: FakeClient;
};

const TTL = 660;

/** A connection lost with the command sent: Valkey may have run it. */
const noAnswer = () => new Error("Connection is closed.");

/** Valkey's own answer: it ran nothing. */
const valkeyRefused = () =>
  Object.assign(
    new Error("OOM command not allowed when used memory > 'maxmemory'."),
    { name: "ReplyError" },
  );

/** What a check sent: its key, its own token, and the stranded tokens it carried. */
function sent(call: unknown[]) {
  const [, keys, key, token, ttl, ...stranded] = call as [
    string,
    number,
    string,
    string,
    string,
    ...string[],
  ];
  return { keys, key, token, ttl, stranded };
}

const lastCheck = () => sent(valkey.eval.mock.lastCall!);

beforeAll(() => {
  process.env.VALKEY_URL = "valkey://replay-store.test:6379";
});

afterAll(() => {
  delete process.env.VALKEY_URL;
});

beforeEach(() => {
  valkey.status = "ready";
  valkey.eval.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("consumeWebhookDeliveryOnce", () => {
  it("takes the id under a token of its own, and the release names that token", async () => {
    const id = randomUUID();
    valkey.eval.mockResolvedValueOnce(1);

    const check = await consumeWebhookDeliveryOnce(7, id, TTL);

    expect(check.outcome).toBe("fresh");
    const { keys, key, token, ttl, stranded } = lastCheck();
    expect({ keys, key, ttl, stranded }).toEqual({
      keys: 1,
      key: `cronium:webhook:delivery:7:${id}`,
      ttl: String(TTL),
      stranded: [],
    });
    expect(check).toEqual({
      outcome: "fresh",
      claim: { key, token, expiresAt: expect.any(Number) as number },
    });

    valkey.eval.mockResolvedValueOnce(1);
    await releaseWebhookDelivery(
      (check as { claim: Parameters<typeof releaseWebhookDelivery>[0] }).claim,
    );
    expect(valkey.eval.mock.lastCall!.slice(1)).toEqual([1, key, token]);
  });

  it("says used when the script finds the id held by another", async () => {
    valkey.eval.mockResolvedValueOnce(0);
    await expect(
      consumeWebhookDeliveryOnce(7, randomUUID(), TTL),
    ).resolves.toEqual({ outcome: "used" });
  });

  it("doesn't send anything while Valkey isn't connected, and has nothing to take back after", async () => {
    const id = randomUUID();
    valkey.status = "reconnecting";

    await expect(consumeWebhookDeliveryOnce(7, id, TTL)).resolves.toEqual({
      outcome: "unavailable",
    });
    expect(valkey.eval).not.toHaveBeenCalled();

    valkey.status = "ready";
    valkey.eval.mockResolvedValueOnce(1);
    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([]);
  });

  it("has nothing to take back after an error Valkey answered with", async () => {
    const id = randomUUID();
    valkey.eval.mockRejectedValueOnce(valkeyRefused());

    await expect(consumeWebhookDeliveryOnce(7, id, TTL)).resolves.toEqual({
      outcome: "unavailable",
    });

    valkey.eval.mockResolvedValueOnce(1);
    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([]);
  });

  it("takes back a check that got no answer with the next check of the same id", async () => {
    const id = randomUUID();
    valkey.eval.mockRejectedValueOnce(noAnswer());
    await expect(consumeWebhookDeliveryOnce(7, id, TTL)).resolves.toEqual({
      outcome: "unavailable",
    });
    const lost = lastCheck().token;

    // Another id, or the same id at another webhook, doesn't carry it.
    valkey.eval.mockResolvedValue(1);
    await consumeWebhookDeliveryOnce(7, randomUUID(), TTL);
    expect(lastCheck().stranded).toEqual([]);
    await consumeWebhookDeliveryOnce(8, id, TTL);
    expect(lastCheck().stranded).toEqual([]);

    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([lost]);

    // Once a script has run with it, it's gone or taken back.
    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([]);
  });

  it("forgets only the stranded claims a check carried", async () => {
    const id = randomUUID();
    // One check is still waiting for Valkey when another on the same id loses its answer.
    let answerFirst!: (taken: number) => void;
    valkey.eval.mockImplementationOnce(
      () => new Promise((resolve) => (answerFirst = resolve)),
    );
    const first = consumeWebhookDeliveryOnce(7, id, TTL);
    valkey.eval.mockRejectedValueOnce(noAnswer());
    await consumeWebhookDeliveryOnce(7, id, TTL);
    const lost = lastCheck().token;

    answerFirst(0);
    await expect(first).resolves.toEqual({ outcome: "used" });

    valkey.eval.mockResolvedValueOnce(1);
    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([lost]);
  });

  it("stops carrying a stranded claim once its id would have expired", async () => {
    const id = randomUUID();
    const start = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(start);
    valkey.eval.mockRejectedValueOnce(noAnswer());
    await consumeWebhookDeliveryOnce(7, id, TTL);

    jest.spyOn(Date, "now").mockReturnValue(start + TTL * 1000);
    valkey.eval.mockResolvedValueOnce(1);
    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([]);
  });

  it("accepts nothing for a memory of no time, and doesn't ask Valkey", async () => {
    await expect(
      consumeWebhookDeliveryOnce(7, randomUUID(), 0),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(valkey.eval).not.toHaveBeenCalled();
  });
});

describe("releaseWebhookDelivery", () => {
  async function takenId() {
    const id = randomUUID();
    valkey.eval.mockResolvedValueOnce(1);
    const check = await consumeWebhookDeliveryOnce(7, id, TTL);
    return {
      id,
      claim: (check as { claim: Parameters<typeof releaseWebhookDelivery>[0] })
        .claim,
    };
  }

  it.each([
    [
      "Valkey doesn't answer",
      () => valkey.eval.mockRejectedValueOnce(noAnswer()),
    ],
    [
      "Valkey refuses",
      () => valkey.eval.mockRejectedValueOnce(valkeyRefused()),
    ],
    [
      "Valkey isn't connected",
      () => {
        valkey.status = "reconnecting";
      },
    ],
  ])(
    "leaves the claim for the next check of the same id when %s",
    async (_when, fail) => {
      const { id, claim } = await takenId();
      const calls = valkey.eval.mock.calls.length;

      fail();
      await expect(releaseWebhookDelivery(claim)).resolves.toBeUndefined();
      if (valkey.status !== "ready") {
        expect(valkey.eval).toHaveBeenCalledTimes(calls);
        valkey.status = "ready";
      }

      valkey.eval.mockResolvedValueOnce(1);
      await consumeWebhookDeliveryOnce(7, id, TTL);
      expect(lastCheck().stranded).toEqual([claim.token]);
    },
  );
});

// What a request does when Valkey has the script and doesn't answer, as a paused
// container or a partition leaves it. tests/storage/webhook-delivery-id-outage.test.ts
// pauses a real one through the real route.
describe("a Valkey that stops answering", () => {
  /** Answers the client is still waiting for, lost after each test if not given. */
  const owed: Array<{ answer: (taken: number) => void; lose: () => void }> = [];

  /** The next script sent gets no answer until the test gives one, or loses it. */
  function answerOwed() {
    const debt = { answer: (_taken: number) => {}, lose: () => {} };
    valkey.eval.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          debt.answer = resolve;
          debt.lose = () => reject(noAnswer());
        }),
    );
    owed.push(debt);
    return debt;
  }

  /** Whether it has settled once everything waiting to run has, with no time passing. */
  async function settledAtOnce(promise: Promise<unknown>) {
    let settled = false;
    void promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await jest.advanceTimersByTimeAsync(0);
    return settled;
  }

  async function takenId() {
    const id = randomUUID();
    valkey.eval.mockResolvedValueOnce(1);
    const check = await consumeWebhookDeliveryOnce(7, id, TTL);
    return { id, claim: (check as { claim: DeliveryClaim }).claim };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    for (const debt of owed.splice(0)) debt.lose();
    await jest.advanceTimersByTimeAsync(0);
    jest.useRealTimers();
  });

  it("says the id can't be checked once it has waited ANSWER_TIMEOUT_MS, and the next check takes its claim back", async () => {
    const id = randomUUID();
    const debt = answerOwed();
    const check = consumeWebhookDeliveryOnce(7, id, TTL);

    await jest.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS - 1);
    expect(await settledAtOnce(check)).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(check).resolves.toEqual({ outcome: "unavailable" });
    const unanswered = lastCheck().token;

    // Valkey runs it once it answers again, so the id is held for a request that was
    // told nothing was taken.
    debt.answer(1);
    valkey.eval.mockResolvedValueOnce(1);
    await expect(consumeWebhookDeliveryOnce(7, id, TTL)).resolves.toMatchObject(
      { outcome: "fresh" },
    );
    expect(lastCheck().stranded).toEqual([unanswered]);
  });

  it.each([
    ["answers", (debt: ReturnType<typeof answerOwed>) => debt.answer(1)],
    [
      "loses the connection",
      (debt: ReturnType<typeof answerOwed>) => debt.lose(),
    ],
  ])(
    "sends nothing while it owes an answer, answering at once, and sends again once it %s",
    async (_how, settle) => {
      const refused = await takenId();
      const debt = answerOwed();
      const first = consumeWebhookDeliveryOnce(7, randomUUID(), TTL);
      await jest.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
      await expect(first).resolves.toEqual({ outcome: "unavailable" });
      const sentSoFar = valkey.eval.mock.calls.length;

      const id = randomUUID();
      const check = consumeWebhookDeliveryOnce(7, id, TTL);
      expect(await settledAtOnce(check)).toBe(true);
      await expect(check).resolves.toEqual({ outcome: "unavailable" });
      const release = releaseWebhookDelivery(refused.claim);
      expect(await settledAtOnce(release)).toBe(true);
      expect(valkey.eval).toHaveBeenCalledTimes(sentSoFar);

      settle(debt);
      valkey.eval.mockResolvedValue(1);
      // Nothing was sent for it, so there's nothing to take back.
      await expect(
        consumeWebhookDeliveryOnce(7, id, TTL),
      ).resolves.toMatchObject({ outcome: "fresh" });
      expect(lastCheck().stranded).toEqual([]);
      // The release that wasn't sent is done by the next check of its id.
      await consumeWebhookDeliveryOnce(7, refused.id, TTL);
      expect(lastCheck().stranded).toEqual([refused.claim.token]);
    },
  );

  it("leaves a claim whose release isn't answered in time for the next check of the id", async () => {
    const { id, claim } = await takenId();
    const debt = answerOwed();
    const release = releaseWebhookDelivery(claim);

    await jest.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS - 1);
    expect(await settledAtOnce(release)).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(release).resolves.toBeUndefined();
    expect(valkey.eval.mock.lastCall!.slice(1)).toEqual([
      1,
      claim.key,
      claim.token,
    ]);

    // The connection goes, so whether Valkey ran it can't be known.
    debt.lose();
    valkey.eval.mockResolvedValueOnce(1);
    await consumeWebhookDeliveryOnce(7, id, TTL);
    expect(lastCheck().stranded).toEqual([claim.token]);
  });

  /**
   * A new copy of the store, whose client connects when it's first used. The fake client
   * is the same object as the other copy's.
   */
  async function freshStore(
    run: (
      store: typeof import("../webhook-replay-store"),
      client: FakeClient,
    ) => Promise<void>,
  ) {
    await jest.isolateModulesAsync(async () => {
      const { mockClient } = jest.requireMock("ioredis") as {
        mockClient: FakeClient;
      };
      await run(await import("../webhook-replay-store"), mockClient);
    });
  }

  it("waits no longer for a connection than for an answer, and sends nothing for a request that stopped waiting", async () => {
    await freshStore(async (store, client) => {
      let connected!: () => void;
      client.connect.mockReturnValueOnce(
        new Promise<void>((resolve) => (connected = resolve)),
      );
      const id = randomUUID();
      const check = store.consumeWebhookDeliveryOnce(7, id, TTL);

      await jest.advanceTimersByTimeAsync(store.ANSWER_TIMEOUT_MS - 1);
      expect(await settledAtOnce(check)).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(await settledAtOnce(check)).toBe(true);
      await expect(check).resolves.toEqual({ outcome: "unavailable" });

      connected();
      client.eval.mockResolvedValueOnce(1);
      await expect(
        store.consumeWebhookDeliveryOnce(7, id, TTL),
      ).resolves.toMatchObject({ outcome: "fresh" });
      expect(client.eval).toHaveBeenCalledTimes(1);
      expect(sent(client.eval.mock.lastCall!).stranded).toEqual([]);
    });
  });

  it("keeps at most MAX_STRANDED_CLAIMS claims, forgetting the oldest, and one taken back doesn't count", async () => {
    await freshStore(async (store, client) => {
      const { MAX_STRANDED_CLAIMS: max } = store;
      const claimOn = (id: string): DeliveryClaim => ({
        key: `cronium:webhook:delivery:9:${id}`,
        token: randomUUID(),
        expiresAt: Date.now() + TTL * 1000,
      });
      /** Releases that can't be sent, which strands each claim. */
      async function strandAll(claims: DeliveryClaim[]) {
        client.status = "reconnecting";
        for (const claim of claims) await store.releaseWebhookDelivery(claim);
        client.status = "ready";
      }
      /** What the next check of the id carries, which it then takes back. */
      async function carriedBy(id: string) {
        await store.consumeWebhookDeliveryOnce(9, id, TTL);
        return sent(client.eval.mock.lastCall!).stranded;
      }
      client.eval.mockResolvedValue(1);

      const takenBack = claimOn("taken-back");
      await strandAll([takenBack]);
      expect(await carriedBy("taken-back")).toEqual([takenBack.token]);

      const claims = Array.from({ length: max + 1 }, (_, i) =>
        claimOn(String(i)),
      );
      await strandAll(claims);
      expect(await carriedBy("0")).toEqual([]);
      expect(await carriedBy("1")).toEqual([claims[1]!.token]);
      expect(await carriedBy(String(max))).toEqual([claims[max]!.token]);
    });
  });
});
