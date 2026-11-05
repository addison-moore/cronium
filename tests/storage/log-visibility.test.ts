/**
 * Execution logs hold script output and anything derived from the owner's secrets.
 * Sharing an event grants view/fork of its template, not its history.
 */
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { logs, users, workflows } from "@/shared/schema";
import { assertEventRelations } from "@/server/security/resource-access";
import { resetDatabase, closePool } from "./helpers/db-reset";

const OWNER = "log-owner";
const OTHER = "log-other";

const eventRow = (userId: string, name: string, shared: boolean) =>
  ({
    userId,
    name,
    shared,
    type: "BASH",
    status: "DRAFT",
    content: "echo hi",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    retries: 0,
  }) as never;

async function seed() {
  await db.insert(users).values([
    { id: OWNER, email: "o@example.test", role: "USER", status: "ACTIVE" },
    { id: OTHER, email: "x@example.test", role: "USER", status: "ACTIVE" },
  ] as never);
  const shared = await storage.createScript(eventRow(OWNER, "shared", true));
  const [workflow] = await db
    .insert(workflows)
    .values({ userId: OWNER, name: "wf", shared: true } as never)
    .returning();
  await db.insert(logs).values({
    eventId: shared.id,
    workflowId: workflow!.id,
    userId: OWNER,
    status: "SUCCESS",
    startTime: new Date(),
    output: "OWNER-SECRET-OUTPUT",
  } as never);
  return { shared, workflow: workflow! };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("getFilteredLogs", () => {
  it("shows the owner their own logs", async () => {
    await seed();
    const { logs: rows, total } = await storage.getFilteredLogs({
      userId: OWNER,
    });
    expect(total).toBe(1);
    expect(rows[0]!.output).toBe("OWNER-SECRET-OUTPUT");
  });

  it.each([
    ["the default view", {}],
    ["the shared-only filter", { sharedOnly: true }],
    ["a search", { search: "SECRET" }],
  ])("hides another user's shared-event output from %s", async (_label, f) => {
    await seed();
    const { logs: rows, total } = await storage.getFilteredLogs({
      userId: OTHER,
      ...f,
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it("hides them from a filter on that specific event", async () => {
    const { shared } = await seed();
    const { logs: rows } = await storage.getFilteredLogs({
      userId: OTHER,
      eventId: String(shared.id),
    });
    expect(rows).toEqual([]);
  });

  it("ignores an unparseable date instead of failing the query", async () => {
    await seed();
    const { total } = await storage.getFilteredLogs({
      userId: OWNER,
      date: "not-a-date",
    });
    expect(total).toBe(1);
  });
});

describe("setUserVariable", () => {
  it("survives concurrent first writes of the same key", async () => {
    await db.insert(users).values({
      id: OWNER,
      email: "o@example.test",
      role: "USER",
      status: "ACTIVE",
    } as never);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        storage.setUserVariable(OWNER, "SHARED_KEY", `value-${i}`),
      ),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const stored = await storage.getUserVariable(OWNER, "SHARED_KEY");
    expect(stored!.value).toMatch(/^value-\d$/);
  });

  it("keeps the description when an update does not provide one", async () => {
    await db.insert(users).values({
      id: OWNER,
      email: "o@example.test",
      role: "USER",
      status: "ACTIVE",
    } as never);
    await storage.setUserVariable(OWNER, "K", "v1", "described");
    const updated = await storage.setUserVariable(OWNER, "K", "v2");
    expect(updated.value).toBe("v2");
    expect(updated.description).toBe("described");
  });
});

describe("servers", () => {
  const seedServer = async () => {
    await db.insert(users).values({
      id: OWNER,
      email: "o@example.test",
      role: "USER",
      status: "ACTIVE",
    } as never);
    return storage.createServer({
      userId: OWNER,
      name: "box",
      address: "10.0.0.1",
      username: "root",
      port: 22,
      sshKey: "PRIVATE-KEY",
    } as never);
  };

  it("forgets the pinned host key when the server moves, and only then", async () => {
    const server = await seedServer();
    await storage.updateServerSshHostKey(server.id, "SHA256:abc");

    await storage.updateServer(server.id, { name: "renamed" });
    await expect(storage.getServer(server.id)).resolves.toMatchObject({
      sshHostKey: "SHA256:abc",
    });

    await storage.updateServer(server.id, { address: "10.0.0.2" });
    await expect(storage.getServer(server.id)).resolves.toMatchObject({
      sshHostKey: null,
    });
  });

  it("forgets the pinned host key when the port changes", async () => {
    const server = await seedServer();
    await storage.updateServerSshHostKey(server.id, "SHA256:abc");
    await storage.updateServer(server.id, { port: 2222 });
    await expect(storage.getServer(server.id)).resolves.toMatchObject({
      sshHostKey: null,
    });
  });

  it("still lets the owner open an event whose server was archived, but not run it", async () => {
    const server = await seedServer();
    const event = await storage.createScript({
      ...(eventRow(OWNER, "bound", false) as object),
      runLocation: "REMOTE",
      serverId: server.id,
    } as never);
    await storage.updateServer(server.id, { isArchived: true });

    await expect(
      assertEventRelations(event.id, OWNER, "view"),
    ).resolves.toBeUndefined();
    await expect(
      assertEventRelations(event.id, OWNER, "execute"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
