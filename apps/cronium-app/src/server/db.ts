import net from "node:net";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { env } from "@/env.mjs";
import * as schema from "../shared/schema";

// PostgreSQL connection pool configuration
// In development, use more aggressive connection pooling to avoid slowdowns
const isDev = process.env.NODE_ENV === "development";

// A lost host or a firewall dropping packets closes nothing, so a connection waiting
// for an answer would wait forever. With this the kernel gives up on it about 40
// seconds after the packets stop, and it fails like any other lost connection. It
// doesn't help a query sent after that, which the kernel retries for 16 minutes, or a
// peer whose kernel still answers, such as a stuck proxy: see closeHungConnections.
export const tcpKeepAlive = {
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
};

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: isDev ? 5 : 20, // fewer connections in dev to avoid connection overhead
  idleTimeoutMillis: isDev ? 10000 : 30000, // close idle clients faster in dev
  connectionTimeoutMillis: isDev ? 10000 : 2000, // longer timeout in dev for slower connections
  ...tcpKeepAlive,
  // Reuse connections more aggressively in development
  ...(isDev && {
    statement_timeout: 30000, // 30 second statement timeout in dev
    query_timeout: 30000, // 30 second query timeout in dev
  }),
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
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
const checkedOutAt = new Map<PoolClient, number>();
pool.on("acquire", (client) => checkedOutAt.set(client, performance.now()));
pool.on("release", (_err, client) => checkedOutAt.delete(client));
pool.on("connect", (client) => {
  client.on("error", (err) => {
    if (!checkedOutAt.has(client)) return;
    const release = client.release.bind(client);
    client.release = () => undefined;
    release(err);
  });
});

/**
 * Asks Postgres to stop what a client's backend is running, over a connection of its
 * own. Postgres only notices a closed socket when it next reads or writes one, so a
 * backend waiting on a lock stays until it gets the lock, and then runs a statement
 * nobody is waiting for. Measured with a table locked: each round of closing left more
 * of them, which would go on until max_connections ran out for everything else.
 *
 * Best effort, since a database that has hung won't answer. It can't reach the wrong
 * backend, because the request carries this one's secret key.
 */
function cancelOnServer(client: PoolClient): void {
  const { processID, secretKey, host, port } = client as PoolClient & {
    processID: number;
    secretKey: number;
  };
  const cancelRequest = Buffer.alloc(16);
  cancelRequest.writeInt32BE(16, 0);
  cancelRequest.writeInt32BE(80877102, 4);
  cancelRequest.writeInt32BE(processID, 8);
  cancelRequest.writeInt32BE(secretKey, 12);

  const socket = host.startsWith("/")
    ? net.connect(`${host}/.s.PGSQL.${port}`)
    : net.connect(port, host);
  socket.on("error", () => undefined);
  socket.setTimeout(5_000, () => socket.destroy());
  socket.end(cancelRequest);
}

/**
 * Closes the connection of every client checked out for longer than `limitMs`, and
 * returns how many that was. A connection can stop answering without closing, and then
 * nothing ever rejects: whoever is waiting on it waits for good, even once the database
 * is back, and its pool slot goes with it. Closing it turns that into a lost connection,
 * which the listener above and every holder already handle, so a limit only has to be
 * longer than anything that really holds a client this long.
 *
 * This isn't pg's `query_timeout`, which rejects the query and leaves the connection in
 * use. Measured through Drizzle on real Postgres: if a slow statement outlasts the
 * timeout on it and on the ROLLBACK queued behind it, the client goes back to the pool
 * with the transaction still open, and the next transaction's COMMIT commits the work
 * of the one that failed. On a hung connection, a timed-out BEGIN also keeps its slot,
 * because Drizzle runs BEGIN outside its try block, and nothing emits an error to give
 * it back. Closing the connection rules out both: Postgres rolls back when it notices.
 */
export function closeHungConnections(limitMs: number): number {
  const now = performance.now();
  let closed = 0;
  for (const [client, since] of checkedOutAt) {
    if (now - since < limitMs) continue;
    client.connection.stream.destroy();
    cancelOnServer(client);
    closed++;
  }
  return closed;
}

export const db = drizzle(pool, { schema });

// Export pool for graceful shutdown
export { pool };
