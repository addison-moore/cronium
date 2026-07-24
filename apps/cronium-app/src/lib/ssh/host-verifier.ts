/**
 * App-side SSH host key verification (Trust-On-First-Use).
 *
 * The ssh2 client accepts ANY host key unless a `hostVerifier` is supplied, so
 * without this an on-path attacker can impersonate a server and capture the
 * decrypted SSH password / private key. This mirrors the Go orchestrator's
 * policy model (internal/executors/ssh/hostkeys.go): "strict" / "accept-new"
 * / "insecure", with the trusted key persisted per-server instead of in a
 * shared known_hosts file.
 *
 * The pure decision logic (`decideHostKey`) and fingerprint formatting are kept
 * free of any database/env dependency so they can be unit-tested directly;
 * `createHostVerifier` wires them to storage + the configured policy.
 */

import { createHash } from "node:crypto";

// Host key policies. "accept-new" mirrors OpenSSH's
// StrictHostKeyChecking=accept-new: unknown hosts are recorded on first
// connection, but a changed key is always fatal.
export const HOST_KEY_POLICY_STRICT = "strict";
export const HOST_KEY_POLICY_ACCEPT_NEW = "accept-new";
export const HOST_KEY_POLICY_INSECURE = "insecure";

export type HostKeyPolicy =
  | typeof HOST_KEY_POLICY_STRICT
  | typeof HOST_KEY_POLICY_ACCEPT_NEW
  | typeof HOST_KEY_POLICY_INSECURE;

export const DEFAULT_HOST_KEY_POLICY: HostKeyPolicy =
  HOST_KEY_POLICY_ACCEPT_NEW;

/**
 * Resolve the configured host key policy from the environment. Unknown values
 * fall back to the safe default (accept-new), matching the orchestrator.
 */
export function resolveHostKeyPolicy(
  raw: string | undefined = process.env.CRONIUM_SSH_HOST_KEY_POLICY,
): HostKeyPolicy {
  switch (raw) {
    case HOST_KEY_POLICY_STRICT:
    case HOST_KEY_POLICY_ACCEPT_NEW:
    case HOST_KEY_POLICY_INSECURE:
      return raw;
    default:
      if (raw) {
        console.warn(
          `Unknown CRONIUM_SSH_HOST_KEY_POLICY "${raw}", falling back to ${DEFAULT_HOST_KEY_POLICY}`,
        );
      }
      return DEFAULT_HOST_KEY_POLICY;
  }
}

/**
 * Format a raw ssh2 host key Buffer as an OpenSSH-style SHA-256 fingerprint,
 * e.g. "SHA256:<unpadded-base64>". This is the value persisted per server and
 * shown in mismatch errors.
 */
export function fingerprintHostKey(key: Buffer): string {
  const digest = createHash("sha256").update(key).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/**
 * A stored fingerprint is only usable if it is a well-formed SHA-256
 * fingerprint. Anything else (legacy/corrupt value) is treated as "no trusted
 * key on file" and re-evaluated under the current policy.
 */
export function isValidStoredFingerprint(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && /^SHA256:[A-Za-z0-9+/]+$/.test(value);
}

export interface HostKeyDecisionInput {
  policy: HostKeyPolicy;
  /** Trusted fingerprint from the server row, or null when none recorded. */
  storedFingerprint: string | null | undefined;
  /** Fingerprint of the key the server just presented. */
  presentedFingerprint: string;
  /** Human-readable server label used in log/error messages. */
  serverLabel: string;
}

export interface HostKeyDecision {
  /** Whether the connection may proceed. */
  accept: boolean;
  /** Fingerprint to persist to the server row (accept-new first contact). */
  persistFingerprint?: string;
  /** Loud warning to log (insecure policy). */
  warn?: string;
  /** Actionable rejection message (mismatch / unknown under strict). */
  error?: string;
}

/**
 * Pure host key policy decision. No I/O — callers persist `persistFingerprint`
 * and surface `error` / `warn`.
 */
export function decideHostKey(input: HostKeyDecisionInput): HostKeyDecision {
  const { policy, presentedFingerprint, serverLabel } = input;

  if (policy === HOST_KEY_POLICY_INSECURE) {
    return {
      accept: true,
      warn: `SSH host key verification is DISABLED (insecure policy) for ${serverLabel}; the connection is exposed to MITM`,
    };
  }

  // Known host: the presented key must match the recorded one exactly.
  if (isValidStoredFingerprint(input.storedFingerprint)) {
    const trusted = input.storedFingerprint;
    if (trusted === presentedFingerprint) {
      return { accept: true };
    }
    return {
      accept: false,
      error:
        `SSH host key mismatch for ${serverLabel}: expected ${trusted} ` +
        `but the server presented ${presentedFingerprint}. This may be a man-in-the-middle ` +
        `attack. If the server was legitimately rebuilt, reset its trusted key ` +
        `(clear ssh_host_key on the server record / re-add the server) and reconnect.`,
    };
  }

  // Unknown host (no trusted key on file, or a malformed stored value).
  if (policy === HOST_KEY_POLICY_STRICT) {
    return {
      accept: false,
      error:
        `Unknown SSH host key for ${serverLabel} (fingerprint ${presentedFingerprint}); ` +
        `host key policy is "strict" so unrecorded hosts are rejected. ` +
        `Record the key out of band or use the "accept-new" policy.`,
    };
  }

  // accept-new: record and proceed.
  return { accept: true, persistFingerprint: presentedFingerprint };
}

export interface HostVerifierContext {
  /** Server row id; when absent (e.g. a pre-create credential test) the
   *  decision is made in-memory and nothing is persisted. */
  serverId?: number | undefined;
  /** Host/address, for messages. */
  host: string;
  /** Override the policy (defaults to the env-configured one). */
  policy?: HostKeyPolicy | undefined;
}

/** ssh2 hostVerifier callback shape (raw key Buffer, async verify). */
export type Ssh2HostVerifier = (
  key: Buffer,
  verify: (valid: boolean) => void,
) => void;

/**
 * Build an ssh2 `hostVerifier` implementing the configured policy. The verifier
 * looks up the trusted fingerprint for the server, applies `decideHostKey`,
 * persists on accept-new first contact, and fails CLOSED on any internal error.
 */
export function createHostVerifier(ctx: HostVerifierContext): Ssh2HostVerifier {
  const policy = ctx.policy ?? resolveHostKeyPolicy();
  const label =
    ctx.serverId != null ? `${ctx.host} (server #${ctx.serverId})` : ctx.host;

  return (key, verify) => {
    void (async () => {
      try {
        const presentedFingerprint = fingerprintHostKey(key);

        let storedFingerprint: string | null = null;
        if (policy !== HOST_KEY_POLICY_INSECURE && ctx.serverId != null) {
          const { storage } = await import("@server/storage");
          const server = await storage.getServer(ctx.serverId);
          storedFingerprint = server?.sshHostKey ?? null;
        }

        const decision = decideHostKey({
          policy,
          storedFingerprint,
          presentedFingerprint,
          serverLabel: label,
        });

        if (decision.warn) {
          console.warn(decision.warn);
        }

        if (!decision.accept) {
          console.error(decision.error);
          verify(false);
          return;
        }

        if (decision.persistFingerprint && ctx.serverId != null) {
          try {
            const { storage } = await import("@server/storage");
            await storage.updateServerSshHostKey(
              ctx.serverId,
              decision.persistFingerprint,
            );
            console.log(
              `Recorded new SSH host key for ${label} (accept-new): ${decision.persistFingerprint}`,
            );
          } catch (persistError) {
            // Trust-on-first-use recording failed; accept this connection (the
            // key was unknown, not mismatched) but surface the problem.
            console.error(
              `Failed to persist SSH host key for ${label}:`,
              persistError,
            );
          }
        }

        verify(true);
      } catch (error) {
        // Fail closed: any unexpected error means we could not verify the host.
        console.error(`SSH host key verification error for ${label}:`, error);
        verify(false);
      }
    })();
  };
}
