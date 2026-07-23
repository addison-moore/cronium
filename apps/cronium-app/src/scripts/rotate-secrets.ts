/**
 * Key-rotation CLI (security plan Phase 2.1). Re-encrypts every at-rest secret
 * from a retired key onto the active key.
 *
 * Usage (from apps/cronium-app):
 *   ENCRYPTION_KEY=<new> ENCRYPTION_KEYS_RETIRED='["<old>"]' \
 *     tsx src/scripts/rotate-secrets.ts [--dry-run]
 *
 * Run repeatedly until it reports 0 remaining; then drop <old> from
 * ENCRYPTION_KEYS_RETIRED. See src/lib/security/secret-rotation.ts for the
 * safety model (idempotent, resumable, both keys in the ring throughout).
 */
import { rotateAllSecrets } from "@/lib/security/secret-rotation";
import { pool } from "@/server/db";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
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
  if (report.totalLegacy > 0) {
    console.warn(
      `\nWARNING: ${report.totalLegacy} legacy (pre-vault) secret value(s) are still bound to the current ENCRYPTION_KEY and CANNOT be rotated by this driver. Rotating the key would ORPHAN them. Migrate them to vault envelopes first (they re-encrypt automatically when the owning record is next saved).`,
    );
  }
  if (!dryRun && report.totalErrors === 0) {
    console.log(
      "Rotation pass complete. Re-run to confirm 0 re-encrypted, then remove the retired key from ENCRYPTION_KEYS_RETIRED.",
    );
  }

  await pool.end();
  process.exit(report.totalErrors > 0 ? 1 : 0);
}

void main();
