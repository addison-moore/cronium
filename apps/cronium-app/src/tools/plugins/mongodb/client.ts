/**
 * The MongoDB driver layer. `mongodb` is imported dynamically inside each
 * function so the driver never enters a static (client) bundle; it is only
 * ever reached server-side (tool actions run in-process in the app). Each call
 * opens a short-lived client and closes it in `finally`.
 */
import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import type { MongoCredentials } from "./schemas";
import {
  buildMongoUri,
  createDocumentAccumulator,
  toJsonSafeBson,
} from "./mongo-helpers";
import type { Db, Document, MongoClient, Sort } from "mongodb";

// Documents pulled per cursor round-trip; bounds memory without a round-trip
// per document.
const BATCH_SIZE = 1_000;

export interface MongoReadOptions {
  /** Stop after this many documents; one extra is read to detect overflow. */
  maxDocuments: number;
  /** Stop once the accumulated JSON payload would exceed this many bytes. */
  maxBytes: number;
  /** Operation timeout in milliseconds (applied as maxTimeMS too). */
  timeoutMs: number;
}

export interface MongoWriteOptions {
  /** Operation timeout in milliseconds. */
  timeoutMs: number;
}

/** A driver-normalized read result, JSON-safe and ready for Unified I/O. */
export interface NormalizedDocumentsResult {
  documents: Record<string, unknown>[];
  documentCount: number;
  /** The read stopped because more documents existed than allowed. */
  truncated: boolean;
  /** The read stopped because `maxBytes` would have been exceeded. */
  bytesExceeded: boolean;
}

async function withClient<T>(
  credentials: MongoCredentials,
  timeoutMs: number,
  fn: (db: Db, client: MongoClient) => Promise<T>,
): Promise<T> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(buildMongoUri(credentials), {
    serverSelectionTimeoutMS: Math.min(timeoutMs, 10_000),
    connectTimeoutMS: Math.min(timeoutMs, 10_000),
    socketTimeoutMS: timeoutMs,
    maxPoolSize: 1,
    appName: "cronium",
  });
  try {
    await client.connect();
    return await fn(client.db(credentials.database), client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Revive MongoDB Extended JSON type wrappers ({"$oid": ...}, {"$date": ...})
 * into BSON values so user-authored filters/documents can reference ObjectIds
 * and dates. Plain values and query operators ($gt, $in, ...) pass through
 * untouched.
 */
async function reviveExtendedJson<T>(value: T): Promise<T> {
  const { BSON } = await import("mongodb");
  return BSON.EJSON.deserialize(value as Document, { relaxed: true }) as T;
}

export async function testMongoConnection(
  credentials: MongoCredentials,
): Promise<ConnectionTestResult> {
  try {
    return await withClient(credentials, 10_000, async (db) => {
      await db.command({ ping: 1 });
      // buildInfo needs no special privileges for an authenticated user, but
      // don't fail the test over a restricted deployment.
      const version = await db
        .command({ buildInfo: 1 })
        .then((info) => (info as { version?: string }).version)
        .catch(() => undefined);
      return {
        success: true,
        message: "Connected to MongoDB",
        details: {
          database: credentials.database,
          server: version ? `MongoDB ${version}` : "MongoDB",
        },
      };
    });
  } catch (error) {
    return testFailure(
      `MongoDB connection failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

/**
 * Streamed, bounded read. The cursor pulls documents a batch at a time and the
 * loop stops the moment a limit is hit, so peak memory is bounded by
 * `maxBytes` no matter how many documents match.
 */
export async function findDocuments(
  credentials: MongoCredentials,
  input: {
    collection: string;
    filter?: Record<string, unknown> | undefined;
    projection?: Record<string, unknown> | undefined;
    sort?: Record<string, unknown> | undefined;
  },
  opts: MongoReadOptions,
): Promise<NormalizedDocumentsResult> {
  const filter = await reviveExtendedJson(input.filter ?? {});
  return withClient(credentials, opts.timeoutMs, async (db) => {
    const cursor = db.collection(input.collection).find(filter, {
      ...(input.projection ? { projection: input.projection } : {}),
      ...(input.sort ? { sort: input.sort as Sort } : {}),
      // One past the cap so overflow is detectable without pulling the rest.
      limit: opts.maxDocuments + 1,
      batchSize: BATCH_SIZE,
      maxTimeMS: opts.timeoutMs,
    });
    try {
      return await drainCursor(cursor, opts);
    } finally {
      await cursor.close().catch(() => undefined);
    }
  });
}

/**
 * Streamed, bounded aggregation. A `$limit` stage is appended after the user's
 * stages so the server stops producing once the cap (+1 for overflow
 * detection) is reached. Callers reject write stages ($out/$merge) beforehand.
 */
export async function aggregateDocuments(
  credentials: MongoCredentials,
  input: { collection: string; pipeline: Record<string, unknown>[] },
  opts: MongoReadOptions,
): Promise<NormalizedDocumentsResult> {
  const pipeline = await reviveExtendedJson(input.pipeline);
  return withClient(credentials, opts.timeoutMs, async (db) => {
    const cursor = db
      .collection(input.collection)
      .aggregate([...pipeline, { $limit: opts.maxDocuments + 1 }], {
        batchSize: BATCH_SIZE,
        maxTimeMS: opts.timeoutMs,
        allowDiskUse: true,
      });
    try {
      return await drainCursor(cursor, opts);
    } finally {
      await cursor.close().catch(() => undefined);
    }
  });
}

async function drainCursor(
  cursor: AsyncIterable<Document>,
  opts: MongoReadOptions,
): Promise<NormalizedDocumentsResult> {
  const acc = createDocumentAccumulator(opts.maxDocuments, opts.maxBytes);
  for await (const doc of cursor) {
    if (!acc.push(doc)) break;
  }
  return {
    documents: acc.documents,
    documentCount: acc.documents.length,
    truncated: acc.truncated,
    bytesExceeded: acc.bytesExceeded,
  };
}

export async function insertDocuments(
  credentials: MongoCredentials,
  input: { collection: string; documents: Record<string, unknown>[] },
  opts: MongoWriteOptions,
): Promise<{ insertedCount: number; insertedIds: string[] }> {
  const documents = await reviveExtendedJson(input.documents);
  return withClient(credentials, opts.timeoutMs, async (db) => {
    const res = await db
      .collection(input.collection)
      .insertMany(documents, { ordered: true });
    return {
      insertedCount: res.insertedCount,
      insertedIds: Object.values(res.insertedIds).map(
        (id) => toJsonSafeBson(id) as string,
      ),
    };
  });
}

export async function updateDocuments(
  credentials: MongoCredentials,
  input: {
    collection: string;
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
    many: boolean;
    upsert: boolean;
  },
  opts: MongoWriteOptions,
): Promise<{
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
}> {
  const filter = await reviveExtendedJson(input.filter);
  const update = await reviveExtendedJson(input.update);
  return withClient(credentials, opts.timeoutMs, async (db) => {
    const collection = db.collection(input.collection);
    const res = input.many
      ? await collection.updateMany(filter, update, { upsert: input.upsert })
      : await collection.updateOne(filter, update, { upsert: input.upsert });
    return {
      matchedCount: res.matchedCount,
      modifiedCount: res.modifiedCount,
      upsertedCount: res.upsertedCount,
    };
  });
}

export async function deleteDocuments(
  credentials: MongoCredentials,
  input: { collection: string; filter: Record<string, unknown>; many: boolean },
  opts: MongoWriteOptions,
): Promise<{ deletedCount: number }> {
  const filter = await reviveExtendedJson(input.filter);
  return withClient(credentials, opts.timeoutMs, async (db) => {
    const collection = db.collection(input.collection);
    const res = input.many
      ? await collection.deleteMany(filter)
      : await collection.deleteOne(filter);
    return { deletedCount: res.deletedCount };
  });
}
