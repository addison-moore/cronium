/**
 * The cache service's connection on real Valkey, when nothing has connected yet.
 *
 * A process loads the cache on its first request that needs it, and a strict read made before
 * the connection was up was refused as if Valkey were down: for MCP OAuth, the first refresh
 * after a restart got a 503, and with the forgiving read before that, invalid_grant.
 *
 * And it can start before Valkey can be reached, as the app can after a host restart, when
 * Docker starts containers without compose's ordering. Its first PING fails, and it used to
 * drop its client then: the cache stayed off until the app restarted, every read a miss and
 * every write refused, while isAvailable() said it was on once ioredis got through.
 */
import Redis from "ioredis";
import { relayTo, type ValkeyRelay } from "./helpers/valkey-relay";

const load = async () => ({
  cache: await import("@/lib/cache/cache-service"),
  unavailable: await import("@/lib/cache/cache-unavailable"),
});
let app: Awaited<ReturnType<typeof load>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let relay: ValkeyRelay;
let admin: Redis;
let consoleError: jest.SpyInstance;

async function until(what: string, done: () => boolean): Promise<void> {
  const limit = Date.now() + 20_000;
  while (!done()) {
    if (Date.now() > limit) throw new Error(`Gave up waiting for ${what}`);
    await sleep(20);
  }
}

beforeAll(async () => {
  relay = await relayTo(process.env.VALKEY_URL!);
  admin = new Redis(process.env.VALKEY_URL!);
  process.env.VALKEY_URL = relay.url;
  process.env.REDIS_URL = relay.url;
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  app = await load();
});

afterAll(async () => {
  await app.cache.cacheService.disconnect();
  admin.disconnect();
  await relay.stop();
  // A client logs its closed connection a moment after QUIT, which Jest reports as a log
  // after the tests are done once the file has gone.
  await sleep(200);
});

it("answers a strict read made while it's still connecting", async () => {
  await app.cache.cacheService.setStrict("connecting:k", { a: 1 }, { ttl: 60 });
  const cache = new app.cache.CacheService();

  try {
    expect(cache.isAvailable()).toBe(false);
    await expect(cache.getStrict("connecting:k")).resolves.toEqual({ a: 1 });
  } finally {
    await cache.disconnect();
  }
});

it("works once Valkey comes up after it", async () => {
  await relay.stop();
  consoleError.mockClear();
  const firstConnectFailed = () =>
    consoleError.mock.calls.some(
      ([message]) => message === "Failed to connect to Valkey/Redis:",
    );
  const cache = new app.cache.CacheService();

  try {
    await until("the first connection to fail", firstConnectFailed);
    expect(cache.isAvailable()).toBe(false);
    await expect(cache.getStrict("late-valkey:k")).rejects.toBeInstanceOf(
      app.unavailable.CacheUnavailableError,
    );
    expect(await cache.get("late-valkey:k")).toBeNull();

    await relay.start();
    await until("the cache to connect", () => cache.isAvailable());

    expect(await cache.set("late-valkey:k", { a: 1 }, { ttl: 60 })).toBe(true);
    expect(await cache.get("late-valkey:k")).toEqual({ a: 1 });
    await cache.setStrict("late-valkey:strict", { b: 2 }, { ttl: 60 });
    expect(await cache.getStrict("late-valkey:strict")).toEqual({ b: 2 });
    expect(await admin.exists("late-valkey:k", "late-valkey:strict")).toBe(2);
  } finally {
    await cache.disconnect();
  }
});
