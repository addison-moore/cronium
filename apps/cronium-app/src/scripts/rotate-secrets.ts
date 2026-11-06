/**
 * At-rest secret maintenance CLI (security plan Phase 2.1).
 *
 * With no flag it rotates: it re-encrypts every at-rest secret from a retired key
 * onto the active key. Run it repeatedly until it reports 0 re-encrypted; then drop
 * <old> from ENCRYPTION_KEYS_RETIRED. See src/lib/security/secret-rotation.ts for
 * the safety model (idempotent, resumable, both keys in the ring throughout).
 *
 * With --encrypt-legacy it instead encrypts webhook secrets, webhook headers and
 * user variables saved before encryption at rest. See
 * src/lib/security/legacy-secrets.ts.
 *
 * From a source checkout (in apps/cronium-app), or in the published image, which
 * ships this script as dist/rotate-secrets.cjs:
 *   tsx src/scripts/rotate-secrets.ts [--dry-run] [--encrypt-legacy]
 *   docker compose exec cronium-worker \
 *     node apps/cronium-app/dist/rotate-secrets.cjs [--dry-run] [--encrypt-legacy]
 *
 * To rotate, also set ENCRYPTION_KEY=<new> ENCRYPTION_KEYS_RETIRED='["<old>"]'.
 *
 * Exits 2 on a bad argument, and 1 if it couldn't run or a row failed. With
 * --encrypt-legacy, a real run also exits 1 if it leaves rows to do. Rotation doesn't:
 * what's left is in its report, and running it again finishes them.
 */
import { driverError } from "@/lib/pg-errors";
import { encryptLegacySecrets } from "@/lib/security/legacy-secrets";
import { rotateAllSecrets } from "@/lib/security/secret-rotation";
import { pool } from "@/server/db";

const FLAGS = new Set(["--dry-run", "--encrypt-legacy"]);

async function rotate(dryRun: boolean): Promise<number> {
  console.log(`Secret rotation${dryRun ? " (dry run)" : ""} starting…`);

  const report = await rotateAllSecrets({ dryRun });
  for (const s of report.surfaces) {
    console.log(
      `  ${s.surface}: scanned=${s.scanned} re-encrypted=${s.reencrypted} skipped=${s.skipped} legacy=${s.legacy} errors=${s.errors}`,
    );
  }
  console.log(
    `Total ${dryRun ? "to re-encrypt" : "re-encrypted"}: ${report.totalReencrypted}; errors: ${report.totalErrors}`,
  );
  const boundToKey = report.totalLegacy - report.plaintextLegacy;
  if (boundToKey > 0) {
    console.warn(
      `\nWARNING: ${boundToKey} legacy (pre-vault) secret value(s) are still bound to the current ENCRYPTION_KEY and CANNOT be rotated by this driver. Rotating the key would ORPHAN them. Migrate them to vault envelopes first (they re-encrypt automatically when the owning record is next saved).`,
    );
  }
  if (report.plaintextLegacy > 0) {
    console.warn(
      `\nWARNING: ${report.plaintextLegacy} webhook or user-variable value(s) are still plaintext from before encryption at rest. Rotating the key doesn't affect them. To encrypt them, run this again with --encrypt-legacy.`,
    );
  }
  if (!dryRun && report.totalErrors === 0) {
    console.log(
      "Rotation pass complete. Re-run to confirm 0 re-encrypted, then remove the retired key from ENCRYPTION_KEYS_RETIRED.",
    );
  }
  return report.totalErrors > 0 ? 1 : 0;
}

async function encryptLegacy(dryRun: boolean): Promise<number> {
  console.log(
    `Encrypting legacy plaintext values${dryRun ? " (dry run)" : ""}…`,
  );

  const report = await encryptLegacySecrets({ dryRun });
  for (const s of report.surfaces) {
    console.log(
      `  ${s.surface}: scanned=${s.scanned} ${dryRun ? "to-encrypt" : "encrypted"}=${s.encrypted} up-to-date=${s.upToDate} changed-during-run=${s.changedDuringRun} failed=${s.failed}`,
    );
  }
  for (const f of report.failures) {
    console.error(
      `  FAILED, left unchanged: ${f.surface} id=${f.id} column=${f.column}: ${f.reason}`,
    );
  }
  console.log(`Legacy rows remaining: ${report.remaining}`);

  if (dryRun) {
    if (report.remaining > 0) {
      console.log("Nothing was written. Run without --dry-run to encrypt.");
    }
    return report.failures.length > 0 ? 1 : 0;
  }
  if (report.remaining > 0) {
    console.warn(
      report.failures.length > 0
        ? "\nFix the rows above, then run this again. Rows already encrypted are not written again."
        : "\nSome rows changed during this run. Run this again to finish them.",
    );
    return 1;
  }
  if (report.totalEncrypted > 0) {
    console.log(
      "\nThe old values stay in the table files until VACUUM FULL, and in existing backups and WAL. See docs/ENVIRONMENT_VARIABLES.md.",
    );
  }
  return report.failures.length > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  // pnpm can pass a literal `--` through to the script.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.filter((arg) => !FLAGS.has(arg));
  if (unknown.length > 0) {
    // A mistyped --dry-run must not turn into a real run.
    console.error(
      `Unknown argument: ${unknown.join(" ")}\nUsage: rotate-secrets [--dry-run] [--encrypt-legacy]`,
    );
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  return args.includes("--encrypt-legacy")
    ? encryptLegacy(dryRun)
    : rotate(dryRun);
}

void main()
  .catch((error: unknown) => {
    console.error(`Failed: ${driverError(error).message ?? String(error)}`);
    return 1;
  })
  .then(async (code) => {
    await pool.end().catch(() => undefined);
    process.exit(code);
  });
