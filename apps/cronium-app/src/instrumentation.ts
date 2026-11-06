/**
 * Runs once when the Next server starts. Next only looks for this file next to
 * `app`, so here in src/.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { flushAuditLogBeforeExit } =
      await import("@/lib/security/audit-log-exit");
    flushAuditLogBeforeExit();
  }
}
