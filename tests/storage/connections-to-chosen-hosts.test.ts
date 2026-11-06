/**
 * The real routes and the real SQL driver, by names a real name server answers, against
 * real Postgres and Valkey. Only where c-ares sends its queries is changed.
 *
 * `chosen-host-connections.test.ts` has the threads and each kind of client. This is what
 * it can't do with a fake server: the driver's read and write paths, a server's real
 * version, and the limit on `servers.testConnection`.
 */
let mockNameServerPort = 0;
let mockResolverOptions: { timeout: number; tries: number } | undefined;
jest.mock("dns/promises", () => {
  const actual =
    jest.requireActual<typeof import("dns/promises")>("dns/promises");
  return {
    ...actual,
    Resolver: class extends actual.Resolver {
      constructor(options?: { timeout?: number; tries?: number }) {
        super(mockResolverOptions ?? options);
        this.setServers([`127.0.0.1:${mockNameServerPort}`]);
      }
    },
  };
});

// The callers below are handed their session directly. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import type { Session } from "next-auth";
import {
  NEVER,
  startNameServer,
  type FakeNameServer,
} from "@/lib/__tests__/helpers/fake-name-server";
import { cacheService } from "@/lib/cache/cache-service";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { UserRole, UserStatus } from "@/shared/schema";
import { postgresDriver } from "@/tools/plugins/sql/drivers/postgres";
import type { SqlCredentials } from "@/tools/plugins/sql/schemas";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(60_000);

const QUICKLY = { timeout: 100, tries: 1 };

function callerFor(userId: string) {
  return createCaller({
    session: {
      user: { id: userId, sessionVersion: 1 },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

const tenant = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

/** The harness's Postgres, by a name that only the fake name server knows. */
function credentialsByName(): SqlCredentials {
  const url = new URL(process.env.DATABASE_URL!);
  return {
    dialect: "postgres",
    host: "tenant-db.test",
    port: Number(url.port),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: "disable",
  };
}

let nameServer: FakeNameServer;

beforeEach(async () => {
  await resetDatabase();
  nameServer = await startNameServer({
    "tenant-db.test": { A: ["127.0.0.1"] },
  });
  mockNameServerPort = nameServer.port;
  mockResolverOptions = undefined;
});

afterEach(async () => {
  await nameServer.close();
});

afterAll(async () => {
  await closePool();
  await cacheService.disconnect();
});

describe("the SQL tool, connecting by name", () => {
  it("reports the server's real version", async () => {
    const outcome = await postgresDriver.testConnection(credentialsByName());

    expect(outcome).toMatchObject({
      success: true,
      details: { server: expect.stringMatching(/^PostgreSQL \d+/) as string },
    });
  });

  it("streams a read", async () => {
    await expect(
      postgresDriver.query(
        credentialsByName(),
        "select n from generate_series(1, 3) n",
        {},
        { maxRows: 10, maxBytes: 10_000, timeoutMs: 5_000 },
      ),
    ).resolves.toMatchObject({
      columns: ["n"],
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
    });
  });

  it("has the database refuse a write on the read path, as ever", async () => {
    await expect(
      postgresDriver.query(
        credentialsByName(),
        "create table refused_write (id int)",
        {},
        { maxRows: 10, maxBytes: 10_000, timeoutMs: 5_000 },
      ),
    ).rejects.toThrow(/read-only transaction/);
  });

  it("runs a write", async () => {
    await expect(
      postgresDriver.execute(
        credentialsByName(),
        "select 1",
        {},
        {
          timeoutMs: 5_000,
        },
      ),
    ).resolves.toEqual({ rowCount: 1 });
  });

  it("tests saved credentials through the real route", async () => {
    await expect(
      callerFor(await tenant()).tools.testCredentials({
        type: "sql",
        credentials: credentialsByName(),
      }),
    ).resolves.toMatchObject({
      success: true,
      message: "Connected to PostgreSQL",
    });
  });
});

describe("servers.testConnection", () => {
  const inputFor = (address: string) => ({
    address,
    port: 1,
    username: "a",
    password: "b",
    timeout: 10,
  });

  it("says a name server didn't answer", async () => {
    mockResolverOptions = QUICKLY;
    nameServer.zone.set("hung.test", NEVER);

    await expect(
      callerFor(await tenant()).servers.testConnection(inputFor("hung.test")),
    ).resolves.toMatchObject({
      success: false,
      message: "getaddrinfo EAI_AGAIN hung.test",
    });
  });

  it("is limited to 10 a minute for each user, and past that connects to nothing", async () => {
    const [someone, someoneElse] = [await tenant(), await tenant()];

    // One at a time, because the limiter reads then writes, so calls made at the same
    // moment can get past it. That's written down at the route.
    for (let call = 0; call < 10; call += 1) {
      await callerFor(someone).servers.testConnection(
        inputFor("tenant-db.test"),
      );
    }
    const asked = nameServer.queries.length;

    await expect(
      callerFor(someone).servers.testConnection(inputFor("tenant-db.test")),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(nameServer.queries).toHaveLength(asked);

    await expect(
      callerFor(someoneElse).servers.testConnection(inputFor("tenant-db.test")),
    ).resolves.toMatchObject({ success: false });
  });
});
