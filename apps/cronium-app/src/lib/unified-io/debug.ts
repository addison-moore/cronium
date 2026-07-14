/**
 * Gated tracing for the Unified I/O data path (one event's `cronium.output()`
 * becoming the next event's `cronium.input()`).
 *
 * This path spans several services and routes (runtime `/output` store → job
 * completion promotion → poll extraction → workflow chaining), so a single
 * end-to-end trace is the fastest way to localize a break. It is off by default
 * and turned on with `CRONIUM_UNIFIED_IO_DEBUG=1` to avoid log noise in normal
 * operation.
 */
const ENABLED =
  process.env.CRONIUM_UNIFIED_IO_DEBUG === "1" ||
  process.env.CRONIUM_UNIFIED_IO_DEBUG === "true";

export function unifiedIoDebug(message: string): void {
  if (ENABLED) {
    console.log(`[UnifiedIO] ${message}`);
  }
}
