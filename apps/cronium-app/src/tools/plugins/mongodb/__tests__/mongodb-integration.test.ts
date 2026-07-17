/**
 * @jest-environment node
 *
 * Integration test for the real MongoDB client (unmocked `mongodb`). It only
 * runs when CRONIUM_MONGO_TEST_URL points at a reachable MongoDB; otherwise
 * the suite is skipped, so CI without a database still passes. It writes to
 * (and drops) a uniquely-named scratch collection — point it at a disposable
 * database, not production.
 *
 * Run locally, e.g.:
 *   docker run -d --rm -p 27017:27017 --name cronium-mongo-test mongo:7
 *   CRONIUM_MONGO_TEST_URL="mongodb://localhost:27017/cronium_test" pnpm exec jest mongodb-integration
 */
import {
  testMongoConnection,
  findDocuments,
  aggregateDocuments,
  insertDocuments,
  updateDocuments,
  deleteDocuments,
} from "../client";
import { findDocumentsAction } from "../actions/find-documents";
import type { MongoCredentials } from "../schemas";
import type { ExecutionContext } from "@/tools/types/tool-plugin";

const url = process.env.CRONIUM_MONGO_TEST_URL;
const describeIf = url ? describe : describe.skip;

// Keep the file valid (>=1 test) when the integration suite is skipped.
if (!url) {
  it("skips MongoDB integration (set CRONIUM_MONGO_TEST_URL to run)", () => {
    expect(true).toBe(true);
  });
}

function credsFromUrl(raw: string): MongoCredentials {
  const u = new URL(raw);
  return {
    scheme: u.protocol === "mongodb+srv:" ? "mongodb+srv" : "mongodb",
    host: u.hostname,
    port: u.port ? Number(u.port) : 27017,
    database: u.pathname.replace(/^\//, "") || "cronium_test",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ...(u.searchParams.get("authSource")
      ? { authSource: u.searchParams.get("authSource")! }
      : {}),
    tls: "default",
  };
}

function ctx(): ExecutionContext {
  return {
    variables: { get: jest.fn(), set: jest.fn() },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
}

describeIf("mongodb client (integration)", () => {
  const creds = url ? credsFromUrl(url) : ({} as MongoCredentials);
  const collection = `cronium_it_${Date.now()}`;
  const readOpts = {
    maxDocuments: 10_000,
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 15_000,
  };
  const writeOpts = { timeoutMs: 15_000 };

  afterAll(async () => {
    if (!url) return;
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(url);
    try {
      await client.db(creds.database).collection(collection).drop();
    } catch {
      // Collection may not exist if the suite failed early.
    } finally {
      await client.close();
    }
  });

  it("passes the connection test and reports the server version", async () => {
    const res = await testMongoConnection(creds);
    expect(res.success).toBe(true);
    expect(res.details?.server).toMatch(/MongoDB/);
  });

  it("inserts documents and returns JSON-safe ids", async () => {
    const res = await insertDocuments(
      creds,
      {
        collection,
        documents: [
          { name: "a", n: 1, at: { $date: "2026-01-01T00:00:00Z" } },
          { name: "b", n: 2 },
          { name: "c", n: 3 },
        ],
      },
      writeOpts,
    );
    expect(res.insertedCount).toBe(3);
    expect(res.insertedIds).toHaveLength(3);
    for (const id of res.insertedIds) {
      expect(id).toMatch(/^[0-9a-f]{24}$/);
    }
  });

  it("finds with filter/sort/projection and normalizes BSON values", async () => {
    const res = await findDocuments(
      creds,
      {
        collection,
        filter: { n: { $gte: 2 } },
        sort: { n: -1 },
        projection: { _id: 0, name: 1, n: 1 },
      },
      readOpts,
    );
    expect(res.documents).toEqual([
      { name: "c", n: 3 },
      { name: "b", n: 2 },
    ]);
    expect(res.truncated).toBe(false);
  });

  it("revives Extended JSON in filters ($oid and $date)", async () => {
    const all = await findDocuments(creds, { collection }, readOpts);
    const idHex = all.documents[0]!._id as string;
    const byId = await findDocuments(
      creds,
      { collection, filter: { _id: { $oid: idHex } } },
      readOpts,
    );
    expect(byId.documentCount).toBe(1);
    expect(byId.documents[0]!._id).toBe(idHex);

    // The $date stored on insert round-trips as an ISO string.
    const dated = await findDocuments(
      creds,
      {
        collection,
        filter: { at: { $gte: { $date: "2025-12-31T00:00:00Z" } } },
      },
      readOpts,
    );
    expect(dated.documentCount).toBe(1);
    expect(dated.documents[0]!.at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stops reading at maxDocuments and flags truncation", async () => {
    const res = await findDocuments(
      creds,
      { collection },
      {
        ...readOpts,
        maxDocuments: 2,
      },
    );
    expect(res.documents).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it("aggregates with $match/$group", async () => {
    const res = await aggregateDocuments(
      creds,
      {
        collection,
        pipeline: [
          { $match: { n: { $gte: 1 } } },
          { $group: { _id: null, total: { $sum: "$n" } } },
        ],
      },
      readOpts,
    );
    expect(res.documents).toEqual([{ _id: null, total: 6 }]);
  });

  it("updates and deletes with counts", async () => {
    const upd = await updateDocuments(
      creds,
      {
        collection,
        filter: { n: { $gte: 2 } },
        update: { $set: { flagged: true } },
        many: true,
        upsert: false,
      },
      writeOpts,
    );
    expect(upd.matchedCount).toBe(2);
    expect(upd.modifiedCount).toBe(2);

    const del = await deleteDocuments(
      creds,
      { collection, filter: { flagged: true }, many: true },
      writeOpts,
    );
    expect(del.deletedCount).toBe(2);

    const remaining = await findDocuments(creds, { collection }, readOpts);
    expect(remaining.documentCount).toBe(1);
  });

  it("runs the full find-documents action end to end", async () => {
    const res = (await findDocumentsAction.execute(
      creds,
      { collection, filter: '{"name": "a"}' },
      ctx(),
    )) as { documents?: Record<string, unknown>[]; documentCount?: number };
    expect(res.documentCount).toBe(1);
    expect(res.documents?.[0]?.name).toBe("a");
  });
});
