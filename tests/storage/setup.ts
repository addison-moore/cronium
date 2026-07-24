/**
 * Storage Tests setup — runs (via jest `setupFiles`) BEFORE any test module is
 * imported, so it lands before the first `@/env.mjs` load.
 *
 * Its one critical job is a fail-fast SAFETY GUARD: these suites TRUNCATE every
 * table between tests. Pointed at the shared external dev database that would be
 * catastrophic. So we refuse to run unless DATABASE_URL clearly names a
 * loopback (localhost / 127.0.0.1 / ::1) disposable instance — exactly what
 * infra/scripts/run-storage-tests.sh exports for its throwaway container.
 */

process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";

// Fallbacks so a bare `jest` invocation (no harness) still fails on the DB
// guard below rather than on a missing-crypto-key error first. The harness sets
// real throwaway values; these only fill gaps.
process.env.ENCRYPTION_KEY ??=
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.AUTH_SECRET ??= "storage-tests-auth-secret-min-32-characters";

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

function assertDisposableDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[storage-tests] DATABASE_URL is unset. These tests must run against a " +
        "DISPOSABLE local Postgres — launch them with `pnpm test:storage` " +
        "(infra/scripts/run-storage-tests.sh), never a bare jest invocation.",
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      `[storage-tests] DATABASE_URL is not a parseable URL: ${url}`,
    );
  }

  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `[storage-tests] REFUSING TO RUN: DATABASE_URL host "${host}" is not a ` +
        "loopback address. These suites TRUNCATE every table between tests and " +
        "must only ever touch a throwaway localhost instance — not the shared " +
        "dev database. Use `pnpm test:storage`, which spins up a disposable " +
        "Postgres container on 127.0.0.1.",
    );
  }
}

assertDisposableDatabase();

// Valkey is required by a handful of storage paths under test (deleteUser /
// deleteServer socket-revocation, terminal job-transition token revocation).
// The harness provides a throwaway Valkey; without one, point at loopback so a
// missing VALKEY_URL surfaces as a connection error, not a config throw.
process.env.VALKEY_URL ??= "redis://127.0.0.1:56379";
process.env.REDIS_URL ??= process.env.VALKEY_URL;
