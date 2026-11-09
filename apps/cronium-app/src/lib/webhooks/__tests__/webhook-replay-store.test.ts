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
  consumeWebhookDeliveryOnce,
  releaseWebhookDelivery,
} from "../webhook-replay-store";

const { mockClient: valkey } = jest.requireMock("ioredis") as {
  mockClient: { status: string; eval: jest.Mock };
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
