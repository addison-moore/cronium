/**
 * Shared helpers for interpreting a tool action's return value.
 *
 * Tool actions historically caught their own errors and returned a
 * `{success:false}` / `{ok:false}` shape instead of throwing, so the executor's
 * retry / circuit-breaker never saw a failure and reported the send as a
 * success. The executor converts such a result into a thrown `ToolActionError`
 * so job status stays honest and the breaker records the failure.
 *
 * Kept out of the executor module (which pulls in the DB, storage, and audit
 * layers) so this decision logic can be unit-tested in isolation.
 */

/**
 * Thrown when a tool action's execute() reports failure via a
 * {success:false}/{ok:false} result.
 */
export class ToolActionError extends Error {
  constructor(
    message: string,
    readonly result: unknown,
  ) {
    super(message);
    this.name = "ToolActionError";
  }
}

/** True if an action result signals failure (slack uses `ok`, others `success`). */
export function isFailureResult(r: unknown): boolean {
  if (!r || typeof r !== "object") return false;
  const obj = r as { ok?: unknown; success?: unknown };
  return obj.ok === false || obj.success === false;
}
