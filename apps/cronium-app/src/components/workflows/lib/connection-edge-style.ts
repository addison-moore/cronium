/**
 * Pure styling maps and edge-update logic for ConnectionEdge.
 */
import type { Edge } from "@xyflow/react";
import { ConnectionType } from "@/shared/schema";

// Style definitions for different connection types — CSS variables so the
// edges follow the semantic tokens in both light and dark themes.
export const connectionStyles: Record<
  ConnectionType,
  { color: string; label: string }
> = {
  [ConnectionType.ALWAYS]: {
    color: "var(--foreground-color)",
    label: "Always",
  },
  [ConnectionType.ON_SUCCESS]: {
    color: "var(--success-color)",
    label: "On Success",
  },
  [ConnectionType.ON_FAILURE]: {
    color: "var(--destructive-color)",
    label: "On Failure",
  },
  [ConnectionType.ON_CONDITION]: {
    color: "var(--primary-color)",
    label: "On Condition",
  },
};

// Helper function to get class name based on connection type
export const getConnectionClasses = (type: ConnectionType): string => {
  switch (type) {
    case ConnectionType.ALWAYS:
      return "border-foreground";
    case ConnectionType.ON_SUCCESS:
      return "border-success";
    case ConnectionType.ON_FAILURE:
      return "border-destructive";
    case ConnectionType.ON_CONDITION:
      return "border-primary";
    default:
      return "border-foreground";
  }
};

/**
 * Return `edges` with the connection type of the edge `edgeId` replaced.
 * Non-matching edges are returned by reference (unchanged).
 */
export function setEdgeConnectionType(
  edges: Edge[],
  edgeId: string,
  newType: ConnectionType,
): Edge[] {
  return edges.map((edge) => {
    if (edge.id === edgeId) {
      return {
        ...edge,
        data: {
          ...edge.data,
          connectionType: newType,
        },
      };
    }
    return edge;
  });
}
