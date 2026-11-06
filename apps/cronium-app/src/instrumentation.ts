/**
 * Runs once when the Next server starts. Next only looks for this file next to
 * `app`, so here in src/.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // This loads the database module, which checks the environment, so a value only
    // env.mjs rejects throws here. If that got out of register(), Next would stay up
    // but answer every route with a 500, including pages that need none of this.
    try {
      const { flushAuditLogBeforeExit } =
        await import("@/lib/security/audit-log-exit");
      flushAuditLogBeforeExit();
    } catch (error) {
      console.error(
        "[AuditLog] Couldn't set up writing the last entries when this server stops:",
        error,
      );
    }
  }
}
