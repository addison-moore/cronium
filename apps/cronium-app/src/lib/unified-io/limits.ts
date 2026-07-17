/**
 * Size limit for data passed between events (Unified I/O).
 *
 * Everything a step publishes — a script's `cronium.output()` and an
 * output-producing tool action's result alike — lands in `job.result` (a jsonb
 * column) and is served to the next step's `cronium.input()`. That channel is
 * for handing a modest result to the next step, not for bulk transfer: the
 * payload is held in memory, written to Postgres, and shipped over HTTP to the
 * runtime.
 *
 * The script route (`/executions/[id]/output`) has always enforced this; tool
 * actions previously had no cap at all, so a tool could publish a payload a
 * script would have been refused. Both now share this constant.
 *
 * Genuinely large extracts should not travel through this channel — use a
 * server-side `INSERT ... SELECT` (Execute Statement) or a Script event that
 * streams with a server-side cursor.
 */
export const MAX_UNIFIED_IO_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Human-readable megabytes, for error messages. */
export function toMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
