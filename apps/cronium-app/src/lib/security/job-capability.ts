/**
 * Per-job workload capability tokens (HI-10).
 *
 * The single shared `INTERNAL_API_KEY` gave any internal caller full,
 * unscoped access to every job, execution, user variable, and server. This
 * module replaces that for the job-scoped internal routes with a short-lived,
 * signed capability token that authorizes exactly one job's worth of work.
 *
 * Trust model: the Next.js app is BOTH the signer (it mints a token when the
 * orchestrator claims a job) and the verifier (the internal routes it exposes).
 * The orchestrator and runtime treat the token as an opaque bearer credential
 * and never need the signing key — so nothing new has to be distributed to the
 * Go services. The signing key is derived from `ENCRYPTION_KEY` via HKDF, so no
 * new secret is introduced either.
 *
 * A token binds the job id, the owning user, the job's target server (if any),
 * and an explicit capability set, and expires. An internal route verifies the
 * signature + expiry AND that the resource in its path is inside the token's
 * scope, so a leaked token can only act on its own job for a short window.
 *
 * Across a key rotation: new tokens are signed with the active key only, and a
 * token signed under a key in ENCRYPTION_KEYS_RETIRED still verifies, so a script
 * running at the key change can finish and report its result.
 *
 * The retired path has no cutoff on purpose. A rule such as "only if `iat` predates
 * the key change" would stop nobody: every honest token under a retired key already
 * predates it, and `iat` is part of what a holder of that key signs, so a forger
 * just backdates it. Only taking the key out of the list ends its trust. That is why
 * a rotation because a key leaked never lists it on a running app: see "If the old
 * key leaked" in docs/ENVIRONMENT_VARIABLES.md.
 */

import { createHmac, hkdfSync, timingSafeEqual } from "crypto";

const SCHEME = "cap.1";
const HKDF_INFO = "cronium-job-capability-v1";
const KEY_LENGTH = 32;
// What env.mjs and the secret vault require of an ENCRYPTION_KEY.
const MASTER_KEY_FORMAT = /^[0-9a-fA-F]{64}$/;

/**
 * Fine-grained capabilities a job token may carry. Each job-scoped internal
 * route requires exactly one of these in addition to a scope match.
 */
export type JobCapability =
  | "job:status" // update job status
  | "job:complete" // mark job completed
  | "job:fail" // mark job failed
  | "job:logs" // append job logs
  | "execution:create" // create an execution record for this job
  | "execution:update" // update an execution belonging to this job
  | "execution:output" // write execution output/data
  | "execution:read" // read execution context/condition
  | "variable:read" // read the owning user's variables
  | "variable:write" // write the owning user's variables
  | "server:read" // read the job's target server connection details
  | "tool:execute"; // run a tool action as the owning user (cronium.toolAction)

/** The full capability set granted to a normal executing job. */
export const DEFAULT_JOB_CAPABILITIES: JobCapability[] = [
  "job:status",
  "job:complete",
  "job:fail",
  "job:logs",
  "execution:create",
  "execution:update",
  "execution:output",
  "execution:read",
  "variable:read",
  "variable:write",
  "server:read",
  "tool:execute",
];

interface CapabilityClaims {
  /** Job id this token is scoped to. */
  jid: string;
  /** Owning user id (tenant). */
  uid: string;
  /** Target server id the job may read, if any. */
  sid?: string;
  /** Granted capabilities. */
  cap: JobCapability[];
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

export interface CapabilityScope {
  jobId: string;
  userId: string;
  serverId?: string | undefined;
  capabilities?: JobCapability[] | undefined;
  /** Time-to-live in seconds (clamped to a safe ceiling). */
  ttlSeconds?: number | undefined;
}

export class CapabilityError extends Error {}

// Absolute ceiling on token lifetime. The real bound is set at claim time: the
// job's own timeout plus a reporting buffer. Tokens are not renewed with the lease,
// so this has to clear any timeout a deployment would configure. At 6h, a longer job
// could not report completion: the 403 made the orchestrator drop the report, and the
// sweeper then failed or re-ran a job that had finished. Keep in step with
// absoluteMaxLifetime in cronium-runtime/internal/auth/jwt.go.
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_TTL_SECONDS = 60 * 60; // 1h

interface SigningKeys {
  /** Signs every new token, and verifies. */
  active: Buffer;
  /** Only verify: tokens signed before an ENCRYPTION_KEY change. */
  retired: Buffer[];
}

let cachedKeys: SigningKeys | null = null;

function deriveSigningKey(master: string): Buffer {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(master, "hex").length === KEY_LENGTH
      ? Buffer.from(master, "hex")
      : Buffer.from(master),
    Buffer.alloc(0),
    Buffer.from(HKDF_INFO),
    KEY_LENGTH,
  );
  return Buffer.from(derived);
}

/**
 * The former ENCRYPTION_KEY values in ENCRYPTION_KEYS_RETIRED. Anything else in
 * there is dropped, never derived from: HKDF happily takes an empty string, and
 * the key that gives is one anyone can compute.
 *
 * A bad list must not throw. authorizeCapability only turns CapabilityError into a
 * 403, and the orchestrator drops a completion report that gets a 403, so a typo here
 * must not cost active-key tokens anything. Tokens under the unreadable keys just
 * stop verifying, which fails closed.
 */
function retiredMasterKeys(): string[] {
  const raw = process.env.ENCRYPTION_KEYS_RETIRED;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const entries: unknown[] = Array.isArray(parsed) ? parsed : [];
  const keys = entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => MASTER_KEY_FORMAT.test(entry));

  if (!Array.isArray(parsed) || keys.length !== entries.length) {
    // The value stays out of the log: even a malformed list holds key material.
    console.warn(
      "[Security] ENCRYPTION_KEYS_RETIRED should be a JSON array of 64-hex keys. Ignoring what isn't, so job tokens signed under those keys won't verify.",
    );
  }
  return keys;
}

/**
 * Derive the capability-signing keys lazily from ENCRYPTION_KEY and
 * ENCRYPTION_KEYS_RETIRED. Lazy so merely importing this module (e.g. during
 * `next build`) never requires a secret; a key is only needed when a token is
 * actually minted or verified.
 */
function signingKeys(): SigningKeys {
  if (cachedKeys) return cachedKeys;
  const master = process.env.ENCRYPTION_KEY;
  if (!master) {
    throw new CapabilityError(
      "ENCRYPTION_KEY is required to mint or verify job capability tokens",
    );
  }
  cachedKeys = {
    active: deriveSigningKey(master),
    retired: retiredMasterKeys().map(deriveSigningKey),
  };
  return cachedKeys;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(key: Buffer, signingInput: string): string {
  return b64url(createHmac("sha256", key).update(signingInput).digest());
}

function signedBy(key: Buffer, signingInput: string, sig: string): boolean {
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(key, signingInput));
  return a.length === b.length && timingSafeEqual(a, b);
}

function clampTtl(ttl: number | undefined): number {
  if (!ttl || ttl <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(ttl, MAX_TTL_SECONDS);
}

/**
 * Mint a capability token for a single job. `nowSeconds` is injectable so the
 * caller controls the clock (and tests are deterministic).
 */
export function mintJobCapability(
  scope: CapabilityScope,
  nowSeconds: number,
): string {
  if (!scope.jobId || !scope.userId) {
    throw new CapabilityError("jobId and userId are required to mint a token");
  }
  const iat = Math.floor(nowSeconds);
  const claims: CapabilityClaims = {
    jid: scope.jobId,
    uid: scope.userId,
    ...(scope.serverId ? { sid: scope.serverId } : {}),
    cap: scope.capabilities ?? DEFAULT_JOB_CAPABILITIES,
    iat,
    exp: iat + clampTtl(scope.ttlSeconds),
  };
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  const signingInput = `${SCHEME}.${payload}`;
  return `${signingInput}.${sign(signingKeys().active, signingInput)}`;
}

export interface VerifiedCapability {
  jobId: string;
  userId: string;
  serverId?: string;
  capabilities: JobCapability[];
  expiresAt: number;
}

/**
 * Verify a token's scheme, signature (under the active key or a retired one), and
 * expiry. Returns the claims on success; throws `CapabilityError` on any failure
 * (fail closed). Does NOT check capabilities or resource scope — callers do that
 * with `assertCapability`/`assertJobScope` against their own path parameters.
 */
export function verifyJobCapability(
  token: string,
  nowSeconds: number,
): VerifiedCapability {
  // Token layout is `${SCHEME}.${payload}.${sig}`. SCHEME itself contains a
  // dot ("cap.1"), so match the fixed prefix and split only the remainder.
  const prefix = `${SCHEME}.`;
  if (!token.startsWith(prefix)) {
    throw new CapabilityError("Unknown capability token scheme");
  }
  const rest = token.slice(prefix.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) {
    throw new CapabilityError("Malformed capability token");
  }
  const payload = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  const signingInput = `${SCHEME}.${payload}`;
  const { active, retired } = signingKeys();
  if (![active, ...retired].some((key) => signedBy(key, signingInput, sig))) {
    throw new CapabilityError("Capability token signature is invalid");
  }

  let claims: CapabilityClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as CapabilityClaims;
  } catch {
    throw new CapabilityError("Capability token payload is unreadable");
  }

  if (typeof claims.exp !== "number" || Math.floor(nowSeconds) >= claims.exp) {
    throw new CapabilityError("Capability token has expired");
  }
  if (!claims.jid || !claims.uid || !Array.isArray(claims.cap)) {
    throw new CapabilityError("Capability token is missing required claims");
  }

  return {
    jobId: claims.jid,
    userId: claims.uid,
    ...(claims.sid ? { serverId: claims.sid } : {}),
    capabilities: claims.cap,
    expiresAt: claims.exp,
  };
}

/** Throw unless the verified token grants `capability`. */
export function assertCapability(
  verified: VerifiedCapability,
  capability: JobCapability,
): void {
  if (!verified.capabilities.includes(capability)) {
    throw new CapabilityError(`Token lacks capability: ${capability}`);
  }
}

/** Test hook: reset the memoized signing keys so env changes take effect. */
export function __resetJobCapabilityKeyForTests(): void {
  cachedKeys = null;
}
