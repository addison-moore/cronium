/**
 * Boot-time secret validation for containerized deployments.
 *
 * Runs before anything else in start.sh so a misconfigured instance refuses
 * to start with an actionable error instead of failing later in a request —
 * or worse, silently storing credentials unencrypted (a wrong-length
 * ENCRYPTION_KEY used to do exactly that).
 */

const PLACEHOLDER_PATTERN =
  /replace[-_]?with|change[-_]?this|change[-_]?me|your[-_]?(secret|key|32)|<paste|example/i;

// Role of the process being validated. The worker only broadcasts to the
// socket server and never serves the orchestrator-facing routes, so it does
// NOT need CRONIUM_ORCHESTRATOR_KEY (least privilege). start-worker.sh passes
// "worker"; the app passes nothing.
const role = process.argv[2] === "worker" ? "worker" : "app";

const errors = [];

function fail(name, message, generate) {
  errors.push(
    `  - ${name}: ${message}` +
      (generate ? `\n      Generate: ${generate}` : ""),
  );
}

function requireSecret(name, { minLength, generate }) {
  const value = process.env[name];
  if (!value) {
    fail(name, "is not set", generate);
    return;
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    fail(name, "still contains a placeholder value", generate);
    return;
  }
  if (minLength && value.length < minLength) {
    fail(name, `must be at least ${minLength} characters`, generate);
  }
}

const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  fail("ENCRYPTION_KEY", "is not set", "openssl rand -hex 32");
} else if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
  fail(
    "ENCRYPTION_KEY",
    `must be exactly 64 hex characters (got ${encryptionKey.length} chars). ` +
      "A wrong-length key would leave stored credentials unencrypted.",
    "openssl rand -hex 32",
  );
}

requireSecret("AUTH_SECRET", {
  minLength: 32,
  generate: "openssl rand -hex 32",
});
// Per-service credentials (HI-10) that replaced the former shared
// INTERNAL_API_KEY: the orchestrator's service identity for the
// orchestrator-facing routes, and the app<->socket-server broadcast secret.
// Only the app-web role verifies the orchestrator on its service-identity
// routes; the worker never does, so it is not required there.
if (role !== "worker") {
  requireSecret("CRONIUM_ORCHESTRATOR_KEY", {
    minLength: 16,
    generate: "openssl rand -base64 32",
  });
}
requireSecret("SOCKET_BROADCAST_KEY", {
  minLength: 16,
  generate: "openssl rand -base64 32",
});
requireSecret("JWT_SECRET", {
  minLength: 32,
  generate: "openssl rand -hex 32",
});

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL", "is not set");
}

const valkeyUrl = process.env.VALKEY_URL ?? process.env.REDIS_URL;
if (!valkeyUrl) {
  fail(
    "VALKEY_URL",
    "or REDIS_URL is required for shared socket replay protection",
  );
} else {
  try {
    const protocol = new URL(valkeyUrl).protocol;
    if (!["redis:", "rediss:", "valkey:", "valkeys:"].includes(protocol)) {
      fail(
        "VALKEY_URL",
        "must use redis://, rediss://, valkey://, or valkeys://",
      );
    }
  } catch {
    fail("VALKEY_URL", "must be a valid connection URL");
  }
}

if (errors.length > 0) {
  console.error("[PREFLIGHT] Refusing to start — invalid configuration:\n");
  console.error(errors.join("\n"));
  console.error(
    "\n[PREFLIGHT] Set these in the .env file next to your docker-compose.yml and run `docker compose up -d` again.",
  );
  process.exit(1);
}

console.log("[PREFLIGHT] Environment validation passed");
