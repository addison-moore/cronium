/**
 * Build the `result` to persist when a job completes.
 *
 * `jobService.updateJobStatus` REPLACES `job.result` — when the caller doesn't
 * supply one it synthesizes a minimal `{ exitCode, metrics }`. So anything the
 * runtime already wrote to `job.result` during the run is lost unless it is
 * carried forward explicitly:
 *
 *   - `cronium.output()`       -> `result.output`     (Unified I/O data passing)
 *   - `cronium.setCondition()` -> `result.condition`  (workflow ON_CONDITION edges)
 *
 * `output` is additionally promoted to `scriptOutput`, the field workflow
 * chaining actually reads.
 *
 * The bug this replaces: the carry-forward only ran when `output` was present,
 * so a script that called `setCondition()` without `output()` had its condition
 * silently dropped at completion — one of the reasons ON_CONDITION never worked.
 */
export function mergeCompletionResult(
  existingResult: Record<string, unknown> | null | undefined,
  exitCode?: number | null,
): Record<string, unknown> | undefined {
  const existing = existingResult ?? {};
  const merged: Record<string, unknown> = { ...existing };

  if (existing.output !== undefined && !("scriptOutput" in existing)) {
    merged.scriptOutput = existing.output;
  }

  // Preserve the exitCode updateJobStatus would otherwise synthesize.
  if (exitCode !== null && exitCode !== undefined) {
    merged.exitCode = exitCode;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}
