/**
 * Env var values are encrypted at rest and record-bound to (eventId, key), and
 * `storage.getEventWithRelations` deliberately returns the ciphertext so dispatch
 * can persist it in jobs.payload. The API read path has to decrypt it for the
 * owner: it used to pass the stored value straight through, so the edit form
 * displayed `crn.1...`, and any save encrypted that ciphertext again, leaving the
 * script with an envelope instead of its secret.
 */
// The routes below sign in with real API tokens or a session passed to the caller.
// The real NextAuth stack needs a request scope this suite does not have.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { asc, count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as restCreate } from "@/app/api/events/route";
import { PATCH as restUpdate } from "@/app/api/events/[id]/route";
import { cacheService } from "@/lib/cache/cache-service";
import { getSecretVault } from "@/lib/security/secret-vault";
import { eventsRouter } from "@/server/api/routers/events";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db, pool } from "@/server/db";
import { storage, type NewEventRelations } from "@/server/storage";
import { envVars, eventServers, events, users } from "@/shared/schema";
import {
  decryptEnvVarValue,
  encryptEnvVarValue,
} from "@/lib/security/field-secret";
import {
  toEventApiDto,
  toEventForkSecurityProjection,
} from "@/server/security/api-dto";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedServer } from "./helpers/seed";

const OWNER = "env-roundtrip-owner";
const SECRET = "s3cret-value";

async function seedOwner() {
  await db.insert(users).values({
    id: OWNER,
    email: "owner@example.test",
    username: "owner",
    role: "USER",
    status: "ACTIVE",
  } as never);
}

function createEvent(overrides: Record<string, unknown> = {}) {
  return storage.createScript({
    userId: OWNER,
    name: "env roundtrip",
    type: "BASH",
    status: "DRAFT",
    content: "echo hi",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    retries: 0,
    ...overrides,
  } as never);
}

async function seedEvent() {
  await seedOwner();
  return createEvent();
}

/** What events.update does with whatever the form submits. */
async function saveEnvVars(
  eventId: number,
  submitted: Array<{ key: string; value: string }>,
) {
  await storage.replaceEventEnvVars(eventId, submitted);
}

async function deliveredValue(eventId: number, key: string) {
  const [row] = await db
    .select()
    .from(envVars)
    .where(eq(envVars.eventId, eventId));
  return decryptEnvVarValue(row!.value, eventId, key);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

// A project-level testTimeout has no effect, and a test that times out here would
// leave its trigger on the table for the next one.
jest.setTimeout(30_000);

describe("replacing an event's variables", () => {
  it("swaps the whole set, in order, each encrypted under its own binding", async () => {
    const event = await seedEvent();
    await saveEnvVars(event.id, [{ key: "OLD", value: "old" }]);

    await saveEnvVars(event.id, [
      { key: "ZED", value: "last-letter" },
      { key: "ALPHA", value: "first-letter" },
    ]);

    const rows = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id))
      .orderBy(asc(envVars.id));
    expect(rows.map(({ key }) => key)).toEqual(["ZED", "ALPHA"]);
    expect(decryptEnvVarValue(rows[0]!.value, event.id, "ZED")).toBe(
      "last-letter",
    );
    expect(decryptEnvVarValue(rows[1]!.value, event.id, "ALPHA")).toBe(
      "first-letter",
    );
    expect(rows.every(({ value }) => value.startsWith("crn.1."))).toBe(true);
  });

  it("clears the set when given none", async () => {
    const event = await seedEvent();
    await saveEnvVars(event.id, [{ key: "OLD", value: "old" }]);

    await saveEnvVars(event.id, []);

    expect(
      await db.select().from(envVars).where(eq(envVars.eventId, event.id)),
    ).toEqual([]);
  });

  it("stores an empty value as empty", async () => {
    const event = await seedEvent();

    await saveEnvVars(event.id, [{ key: "BLANK", value: "" }]);

    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id));
    expect(row!.value).toBe("");
  });

  it("leaves another event's variables alone", async () => {
    const event = await seedEvent();
    const other = await createEvent();
    await saveEnvVars(other.id, [{ key: "THEIRS", value: "kept" }]);

    await saveEnvVars(event.id, [{ key: "MINE", value: "new" }]);
    await saveEnvVars(event.id, []);

    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, other.id));
    expect(row!.key).toBe("THEIRS");
  });
});

describe("creating an event with its variables and servers", () => {
  function createWith(relations: NewEventRelations) {
    return storage.createScript(
      {
        userId: OWNER,
        name: "env roundtrip",
        type: "BASH",
        status: "DRAFT",
        content: "echo hi",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 0,
      } as never,
      relations,
    );
  }

  beforeEach(seedOwner);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes them together, encrypted under the event's own id", async () => {
    const serverId = await seedServer(OWNER);

    const event = await createWith({
      envVars: [{ key: "API_KEY", value: SECRET }],
      serverIds: [serverId],
    });

    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
    expect(await storage.getEventServers(event.id)).toMatchObject([
      { eventId: event.id, serverId },
    ]);
  });

  it("writes nothing if a server can't be linked", async () => {
    const archived = await seedServer(OWNER, { isArchived: true });

    await expect(
      createWith({
        envVars: [{ key: "API_KEY", value: SECRET }],
        serverIds: [archived],
      }),
    ).rejects.toThrow("Unauthorized event server relationship");

    expect(await db.select().from(events)).toEqual([]);
    expect(await db.select().from(envVars)).toEqual([]);
  });

  it("encrypts every value before the transaction opens", async () => {
    const encrypt = jest.spyOn(getSecretVault(), "encrypt");
    const transaction = jest.spyOn(db, "transaction");

    await createWith({ envVars: [{ key: "API_KEY", value: SECRET }] });

    expect(encrypt).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(encrypt.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0]!,
    );
  });

  it("takes its ids from the sequence every other insert uses", async () => {
    const first = await createEvent();
    const [inserted] = await db
      .insert(events)
      .values({ userId: OWNER, name: "raw", type: "BASH", content: "echo hi" })
      .returning({ id: events.id });
    const second = await createEvent();

    expect([inserted!.id, second.id]).toEqual([first.id + 1, first.id + 2]);
  });
});

describe("a save that fails partway", () => {
  const TRIGGER = "env_var_roundtrip_test";
  const ADVISORY_LOCK = 4242;

  const OLD = [
    { key: "OLD_A", value: "old-a" },
    { key: "OLD_B", value: "old-b" },
  ];
  // The first row goes in before the one that fails.
  const REFUSED_PARTWAY = [
    { key: "NEW_A", value: "new-a" },
    { key: "REFUSED", value: "new-b" },
    { key: "NEW_C", value: "new-c" },
  ];
  const REFUSE = "RAISE EXCEPTION 'refused by the test'";

  /** Has Postgres run `action` when a row with this key is inserted. */
  async function whenInserting(key: string, action: string) {
    await pool.query(`
      CREATE FUNCTION ${TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.key = '${key}' THEN ${action}; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON env_vars
        FOR EACH ROW EXECUTE FUNCTION ${TRIGGER}();
    `);
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    await pool.query(`
      DROP TRIGGER IF EXISTS ${TRIGGER} ON env_vars;
      DROP FUNCTION IF EXISTS ${TRIGGER}();
    `);
  });

  function rowsOf(eventId: number) {
    return db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, eventId))
      .orderBy(asc(envVars.id));
  }

  async function keysOf(eventId: number) {
    return (await rowsOf(eventId)).map(({ key }) => key);
  }

  async function eventWithOldVars() {
    const event = await seedEvent();
    await saveEnvVars(event.id, OLD);
    return { id: event.id, before: await rowsOf(event.id) };
  }

  describe("in storage", () => {
    it("keeps the old rows when Postgres refuses a later one", async () => {
      const { id, before } = await eventWithOldVars();
      await whenInserting("REFUSED", REFUSE);

      await expect(saveEnvVars(id, REFUSED_PARTWAY)).rejects.toThrow();

      expect(await rowsOf(id)).toEqual(before);
    });

    it("keeps the old rows when the connection drops partway", async () => {
      const { id, before } = await eventWithOldVars();
      await whenInserting(
        "REFUSED",
        "PERFORM pg_terminate_backend(pg_backend_pid()); PERFORM pg_sleep(5)",
      );
      // A checked-out client that loses its connection emits `error` with nothing
      // listening, on top of the rejected query. In the app Next's uncaughtException
      // handler logs that. Here it would fail the test instead.
      pool.once("acquire", (client: PoolClient) => {
        client.on("error", () => undefined);
      });

      await expect(saveEnvVars(id, REFUSED_PARTWAY)).rejects.toThrow();

      expect(await rowsOf(id)).toEqual(before);
    });

    it("keeps the old rows when the vault fails on a later value", async () => {
      const { id, before } = await eventWithOldVars();
      const vault = getSecretVault();
      const encrypt = vault.encrypt.bind(vault);
      jest.spyOn(vault, "encrypt").mockImplementation((plaintext, binding) => {
        if (binding.recordId === "REFUSED")
          throw new Error("vault unavailable");
        return encrypt(plaintext, binding);
      });

      await expect(saveEnvVars(id, REFUSED_PARTWAY)).rejects.toThrow(
        "vault unavailable",
      );

      expect(await rowsOf(id)).toEqual(before);
    });

    it("encrypts every value before the transaction opens", async () => {
      const { id } = await eventWithOldVars();
      const encrypt = jest.spyOn(getSecretVault(), "encrypt");
      const transaction = jest.spyOn(db, "transaction");

      await saveEnvVars(id, [
        { key: "NEW_A", value: "new-a" },
        { key: "NEW_B", value: "new-b" },
      ]);

      expect(encrypt).toHaveBeenCalledTimes(2);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(Math.max(...encrypt.mock.invocationCallOrder)).toBeLessThan(
        transaction.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe("while a save is in progress", () => {
    let lockHolder: PoolClient | null = null;

    /** Stops any save that reaches a row with this key, until `letSavesFinish`. */
    async function holdSavesAt(key: string) {
      lockHolder = await pool.connect();
      await lockHolder.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK]);
      await whenInserting(
        key,
        `PERFORM pg_advisory_xact_lock(${ADVISORY_LOCK})`,
      );
    }

    async function letSavesFinish() {
      if (!lockHolder) return;
      await lockHolder.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK]);
      lockHolder.release();
      lockHolder = null;
    }

    afterEach(letSavesFinish);

    async function connectionsWaitingOnALock(expected: number) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const { rows } = await pool.query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (rows[0]!.waiting >= expected) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Never saw ${expected} connections waiting on a lock`);
    }

    it("shows a reader the old rows, not part of the new ones", async () => {
      const { id, before } = await eventWithOldVars();
      await holdSavesAt("HOLD");

      const saving = saveEnvVars(id, [
        { key: "NEW_A", value: "new-a" },
        { key: "HOLD", value: "new-b" },
      ]);
      await connectionsWaitingOnALock(1);

      expect(await rowsOf(id)).toEqual(before);
      const read = await storage.getEventWithRelations(id);
      expect(read!.envVars.map(({ key }) => key).sort()).toEqual([
        "OLD_A",
        "OLD_B",
      ]);

      await letSavesFinish();
      await saving;
      expect(await keysOf(id)).toEqual(["NEW_A", "HOLD"]);
    });

    it("leaves one save's rows when two overlap, not a mix of both", async () => {
      const { id } = await eventWithOldVars();
      await holdSavesAt("HOLD");

      const first = saveEnvVars(id, [
        { key: "FIRST", value: "1" },
        { key: "HOLD", value: "1" },
      ]);
      await connectionsWaitingOnALock(1);
      const second = saveEnvVars(id, [{ key: "SECOND", value: "2" }]);
      await Promise.race([second, connectionsWaitingOnALock(2)]);

      await letSavesFinish();
      await Promise.all([first, second]);

      expect(await keysOf(id)).toEqual(["SECOND"]);
    });
  });

  describe("through the routes", () => {
    const createCaller = createCallerFactory(
      createTRPCRouter({ events: eventsRouter }),
    );

    function trpc() {
      return createCaller({
        session: {
          user: {
            id: OWNER,
            email: "owner@example.test",
            role: "USER",
            status: "ACTIVE",
            sessionVersion: 1,
          },
          expires: new Date(Date.now() + 60_000).toISOString(),
        },
        db,
        headers: new Headers(),
        tokenScopes: null,
        requestSource: null,
      } as never);
    }

    async function restToken() {
      const token = randomUUID();
      await storage.createApiToken({
        userId: OWNER,
        name: "ci",
        token,
        scopes: ["full"],
      } as never);
      return { authorization: `Bearer ${token}` };
    }

    const newEvent = {
      name: "created with variables",
      type: "BASH",
      content: "echo hi",
      status: "ACTIVE",
      triggerType: "SCHEDULE",
      scheduleNumber: 5,
      scheduleUnit: "MINUTES",
      runLocation: "LOCAL",
      timeoutValue: 30,
      timeoutUnit: "SECONDS",
      retries: 0,
    };

    async function eventCount() {
      const [row] = await db.select({ n: count() }).from(events);
      return row!.n;
    }

    beforeEach(() => {
      // These tests fail on purpose, and the routes log it.
      jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    async function restPatch(id: number, body: unknown) {
      return restUpdate(
        new NextRequest(`http://localhost:5001/api/events/${id}`, {
          method: "PATCH",
          headers: await restToken(),
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: String(id) }) },
      );
    }

    it("REST PATCH answers 500 and keeps the old rows, and a retry saves", async () => {
      const { id, before } = await eventWithOldVars();
      await whenInserting("REFUSED", REFUSE);

      const body = { description: "edited", envVars: REFUSED_PARTWAY };
      expect((await restPatch(id, body)).status).toBe(500);
      expect(await rowsOf(id)).toEqual(before);

      await pool.query(`DROP TRIGGER ${TRIGGER} ON env_vars`);
      expect((await restPatch(id, body)).status).toBe(200);
      expect(await keysOf(id)).toEqual(["NEW_A", "REFUSED", "NEW_C"]);
    });

    it("REST PATCH can change the variables and nothing else", async () => {
      const { id } = await eventWithOldVars();

      const res = await restPatch(id, {
        envVars: [{ key: "NEW_A", value: "new-a" }],
      });

      expect(res.status).toBe(200);
      expect(await keysOf(id)).toEqual(["NEW_A"]);
    });

    it("tRPC events.update fails and keeps the old rows, and a retry saves", async () => {
      const { id, before } = await eventWithOldVars();
      await whenInserting("REFUSED", REFUSE);

      await expect(
        trpc().events.update({ id, envVars: REFUSED_PARTWAY }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(await rowsOf(id)).toEqual(before);

      await pool.query(`DROP TRIGGER ${TRIGGER} ON env_vars`);
      await trpc().events.update({ id, envVars: REFUSED_PARTWAY });
      expect(await keysOf(id)).toEqual(["NEW_A", "REFUSED", "NEW_C"]);
    });

    it("REST POST leaves no event behind when a later row is refused", async () => {
      await seedOwner();
      const headers = await restToken();
      await whenInserting("REFUSED", REFUSE);

      const res = await restCreate(
        new NextRequest("http://localhost:5001/api/events", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...newEvent, envVars: REFUSED_PARTWAY }),
        }),
      );

      expect(res.status).toBe(500);
      expect(await eventCount()).toBe(0);
      expect(await db.select().from(envVars)).toEqual([]);
    });

    it("tRPC events.create leaves no event behind when a later row is refused", async () => {
      await seedOwner();
      await whenInserting("REFUSED", REFUSE);

      await expect(
        trpc().events.create({
          ...newEvent,
          envVars: REFUSED_PARTWAY,
        } as never),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

      expect(await eventCount()).toBe(0);
      expect(await db.select().from(envVars)).toEqual([]);
    });

    it("tRPC events.fork leaves no event behind when a later row is refused", async () => {
      const { id } = await eventWithOldVars();
      await saveEnvVars(id, REFUSED_PARTWAY);
      await whenInserting("REFUSED", REFUSE);

      await expect(trpc().events.fork({ id })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });

      expect(await eventCount()).toBe(1);
      expect(await keysOf(id)).toEqual(["NEW_A", "REFUSED", "NEW_C"]);
    });

    it("tRPC events.fork leaves no event behind when a server can't be linked", async () => {
      const { id } = await eventWithOldVars();
      const serverId = await seedServer(OWNER, { isArchived: true });
      await db.insert(eventServers).values({ eventId: id, serverId });

      await expect(trpc().events.fork({ id })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });

      expect(await eventCount()).toBe(1);
    });
  });
});

describe("env var read/save round trip", () => {
  it("shows the owner plaintext, and saving it back keeps the secret intact", async () => {
    const event = await seedEvent();
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: SECRET,
    });

    const read = await storage.getEventWithRelations(event.id);
    const dto = toEventApiDto(read!, OWNER, { revealEnvVarValues: true });
    expect(dto.envVars[0]!.value).toBe(SECRET);

    await saveEnvVars(
      event.id,
      dto.envVars.map(({ key, value }) => ({ key, value })),
    );

    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
    // Still ciphertext at rest: the fix must not have stored plaintext.
    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id));
    expect(row!.value).not.toContain(SECRET);
    expect(row!.value.startsWith("crn.1.")).toBe(true);
  });

  it("does not wrap again when a stale client resubmits ciphertext", async () => {
    const event = await seedEvent();
    const ciphertext = encryptEnvVarValue(SECRET, event.id, "API_KEY");

    await saveEnvVars(event.id, [{ key: "API_KEY", value: ciphertext }]);

    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id));
    expect(row!.value).toBe(ciphertext);
    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
  });

  it("heals rows already wrapped several times by the old form", async () => {
    const event = await seedEvent();
    let wrapped = SECRET;
    for (let saves = 0; saves < 3; saves++) {
      wrapped = encryptEnvVarValue(wrapped, event.id, "API_KEY");
    }
    await db.insert(envVars).values({
      eventId: event.id,
      key: "API_KEY",
      value: wrapped,
    });

    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
    const read = await storage.getEventWithRelations(event.id);
    const dto = toEventApiDto(read!, OWNER, { revealEnvVarValues: true });
    expect(dto.envVars[0]!.value).toBe(SECRET);
  });

  it("keeps a real value that merely looks like an envelope", async () => {
    const event = await seedEvent();
    const lookalike = "crn.1.notreal.a.b.c";
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: lookalike,
    });
    expect(await deliveredValue(event.id, "API_KEY")).toBe(lookalike);
  });

  it("hides values from callers that were not granted them, keeping the keys", async () => {
    const event = await seedEvent();
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: SECRET,
    });
    const read = await storage.getEventWithRelations(event.id);

    const dto = toEventApiDto(read!, OWNER);
    expect(dto.envVars[0]).toMatchObject({ key: "API_KEY", value: "" });
    expect(JSON.stringify(dto)).not.toContain("crn.1.");
    expect(JSON.stringify(dto)).not.toContain(SECRET);
  });

  it("re-encrypts under the fork's own binding when an owner forks", async () => {
    const source = await seedEvent();
    await storage.createEnvVar({
      eventId: source.id,
      key: "API_KEY",
      value: SECRET,
    });
    const read = await storage.getEventWithRelations(source.id);
    const { envVars: projected } = toEventForkSecurityProjection(read!, OWNER);
    expect(projected[0]!.value).toBe(SECRET);

    const fork = await storage.createScript({
      userId: OWNER,
      name: "fork",
      type: "BASH",
      status: "DRAFT",
      content: "echo hi",
      scheduleNumber: 1,
      scheduleUnit: "MINUTES",
      timeoutValue: 30,
      timeoutUnit: "SECONDS",
      retries: 0,
    } as never);
    await saveEnvVars(fork.id, [
      { key: "API_KEY", value: projected[0]!.value },
    ]);

    expect(await deliveredValue(fork.id, "API_KEY")).toBe(SECRET);
  });
});
