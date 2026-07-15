/**
 * Resolve the input a workflow node receives (its `cronium.input()`), given its
 * incoming edge and the results of already-completed nodes.
 *
 * Two documented cases:
 *  - **Start node** (no incoming edge) → the workflow's trigger input.
 *  - **Downstream node** → its predecessor's `cronium.output()`. If the
 *    predecessor failed or emitted nothing, the node receives an empty object —
 *    NOT the workflow trigger input (that belongs to start nodes; feeding it to
 *    a mid-workflow node would be indistinguishable from "start of workflow" and
 *    pass stale data).
 *
 * Scalars are wrapped as `{ value }` so a `cronium.output("done")` survives the
 * object-typed input channel; objects/arrays pass through unchanged.
 *
 * Cronium workflows are single-predecessor (fan-in is rejected at save time), so
 * `incomingConnections` holds at most one edge.
 */
export interface PredecessorResult {
  success: boolean;
  scriptOutput?: unknown;
}

export function resolveWorkflowInput(
  incomingConnections: { sourceNodeId: number }[],
  predecessorResults: Map<number, PredecessorResult>,
  initialInputData: Record<string, unknown> = {},
): Record<string, unknown> {
  if (incomingConnections.length === 0) {
    return { ...initialInputData };
  }

  let latestOutput: unknown;
  let hasValidOutput = false;
  for (const connection of incomingConnections) {
    const result = predecessorResults.get(connection.sourceNodeId);
    if (
      result?.success &&
      result.scriptOutput !== undefined &&
      result.scriptOutput !== null
    ) {
      latestOutput = result.scriptOutput;
      hasValidOutput = true;
    }
  }

  if (!hasValidOutput) {
    return {};
  }

  if (typeof latestOutput === "object" && latestOutput !== null) {
    return latestOutput as Record<string, unknown>;
  }
  return { value: latestOutput };
}
