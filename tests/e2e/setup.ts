/**
 * Safety guard for the E2E suite: refuse to run against anything but a
 * loopback (disposable) database. The dev environment's DATABASE_URL points at
 * a SHARED external database — these tests create users/events/workflows and
 * must never touch it. Same contract as tests/storage/setup.ts.
 */
const url = process.env.DATABASE_URL ?? "";

let host = "";
try {
  host = new URL(url).hostname;
} catch {
  // fall through — empty host fails the check below
}

if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  throw new Error(
    `E2E tests refuse to run: DATABASE_URL host "${host}" is not loopback. ` +
      "Run them via infra/scripts/run-e2e-tests.sh (pnpm test:e2e), which " +
      "provisions a disposable Postgres.",
  );
}

if (!process.env.E2E_APP_URL) {
  throw new Error(
    "E2E_APP_URL is not set. Run via infra/scripts/run-e2e-tests.sh (pnpm test:e2e).",
  );
}

// Real containers + scheduler ticks: generous ceiling per test.
jest.setTimeout(240_000);
