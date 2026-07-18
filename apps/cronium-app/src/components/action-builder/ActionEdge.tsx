"use client";

import React from "react";
import {
  type EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from "@xyflow/react";
import { Badge } from "@cronium/ui";

export function ActionEdge({
  id: _id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // CSS variables so edges follow the semantic tokens in both themes
  const getEdgeStyle = () => {
    if (data?.connectionType === "success") {
      return { stroke: "var(--success-color)", strokeWidth: 2 };
    }
    if (data?.connectionType === "failure") {
      return { stroke: "var(--destructive-color)", strokeWidth: 2 };
    }
    return { stroke: "var(--muted-foreground-color)", strokeWidth: 2 };
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={{ ...getEdgeStyle(), ...style }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            {/* Opaque backing so the edge line passes behind the label */}
            <div className="bg-background rounded-full">
              <Badge
                variant="outline"
                className={`text-xs ${
                  data.connectionType === "success"
                    ? "border-success/40 bg-success/10 text-success-text"
                    : data.connectionType === "failure"
                      ? "border-destructive/40 bg-destructive/10 text-destructive-text"
                      : "border-border bg-muted/60 text-muted-foreground"
                }`}
              >
                {(data.label as string) ?? ""}
              </Badge>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
