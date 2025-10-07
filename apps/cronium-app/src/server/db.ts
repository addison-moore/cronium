import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env.mjs";
import * as schema from "../shared/schema";

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
  console.error("Unexpected error on idle client", err);
});

export const db = drizzle(pool, { schema });

// Export pool for graceful shutdown
export { pool };
