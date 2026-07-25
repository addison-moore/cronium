/**
 * Helpers for the E2E pipeline suite. Deliberately dependency-light: raw SQL
 * via `pg` for seeding/assertions and plain fetch against the app's tRPC HTTP
 * endpoint — no imports from the app source, so this suite exercises only the
 * real wire surface a user/API client sees.
 */
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";

export const APP_URL = process.env.E2E_APP_URL!;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});

/** Seed a user + an ACTIVE full-scope API token; returns the RAW bearer token. */
export async function seedPrincipal(): Promise<{
  userId: string;
  token: string;
}> {
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const userId = `e2e-user-${suffix}`;
  await pool.query(
    `INSERT INTO users (id, email, username, role) VALUES ($1, $2, $3, 'USER')`,
    [userId, `${suffix}@e2e.test`, `e2e-${suffix}`],
  );
  const token = `e2e-token-${randomUUID()}${randomUUID()}`;
  // Tokens are stored as SHA-256 hex (lib/api-token-hash.ts). Scopes must be
  // explicit — bearer tokens with an empty scope list are deny-all.
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  await pool.query(
    `INSERT INTO api_tokens (user_id, name, token, status, expires_at, scopes)
     VALUES ($1, 'e2e', $2, 'ACTIVE', NOW() + interval '1 day', $3::jsonb)`,
    [userId, tokenHash, JSON.stringify(["full"])],
  );
  return { userId, token };
}

/** Call a tRPC mutation over HTTP with bearer auth (superjson envelope). */
export async function trpc<T = unknown>(
  token: string,
  proc: string,
  input: unknown,
): Promise<T> {
  const res = await fetch(`${APP_URL}/api/trpc/${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ json: input }),
  });
  const body = (await res.json()) as {
    result?: { data?: { json?: T } };
    error?: unknown;
  };
  if (!res.ok || body.error) {
    throw new Error(
      `tRPC ${proc} failed (HTTP ${res.status}): ${JSON.stringify(body.error ?? body)}`,
    );
  }
  return body.result?.data?.json as T;
}

/** Thrown by a poll callback to abort immediately (e.g. the job FAILED). */
export class FatalPollError extends Error {}

/**
 * Poll `fn` until it returns a value, `FatalPollError` is thrown, or the
 * timeout elapses. Non-fatal errors from `fn` are retried.
 */
export async function poll<T>(
  label: string,
  fn: () => Promise<T | undefined>,
  { timeoutMs = 120_000, intervalMs = 1_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value !== undefined) return value;
    } catch (error) {
      if (error instanceof FatalPollError) throw error;
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for: ${label}` +
      (lastError ? ` (last error: ${String(lastError)})` : ""),
  );
}
