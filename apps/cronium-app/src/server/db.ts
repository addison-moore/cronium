import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { env } from "@/env.mjs";
import * as schema from "../shared/schema";
import { failureWithStack } from "@/lib/pg-errors";

// PostgreSQL connection pool configuration
// In development, use more aggressive connection pooling to avoid slowdowns
const isDev = process.env.NODE_ENV === "development";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: isDev ? 5 : 20, // fewer connections in dev to avoid connection overhead
  idleTimeoutMillis: isDev ? 10000 : 30000, // close idle clients faster in dev
  connectionTimeoutMillis: isDev ? 10000 : 2000, // longer timeout in dev for slower connections
  // Reuse connections more aggressively in development
  ...(isDev && {
    statement_timeout: 30000, // 30 second statement timeout in dev
    query_timeout: 30000, // 30 second query timeout in dev
  }),
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", failureWithStack(err));
});

// The pool only listens for errors on idle clients. A client that loses its connection
// while checked out, as every db.transaction's is, emits `error` with nothing
// listening, and that ends any process with no uncaughtException handler, such as the
// worker.
//
// Nothing is logged here: the listener above logs idle clients, and whoever holds a
// checked-out client gets the rejected query.
//
// The slot is given back here because a holder may never do it. Drizzle runs BEGIN
// outside its try block, so a connection lost on BEGIN is never released, and a dead
// client still counts towards `max`. Enough of those and every connect times out: the
// process stays up and does nothing. Measured on the worker: 20 drops on BEGIN stopped
// it dispatching for good. The holder's own release comes later or not at all, and
// pg-pool throws on a second one, so it becomes a no-op.
const checkedOut = new WeakSet<PoolClient>();
pool.on("acquire", (client) => checkedOut.add(client));
pool.on("release", (_err, client) => checkedOut.delete(client));
pool.on("connect", (client) => {
  client.on("error", (err) => {
    if (!checkedOut.has(client)) return;
    const release = client.release.bind(client);
    client.release = () => undefined;
    release(err);
  });
});

export const db = drizzle(pool, { schema });

// Export pool for graceful shutdown
export { pool };
