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

  const getEdgeStyle = () => {
    if (data?.connectionType === "success") {
      return { stroke: "#10b981", strokeWidth: 2 };
    }
    if (data?.connectionType === "failure") {
      return { stroke: "#ef4444", strokeWidth: 2 };
    }
    return { stroke: "#6b7280", strokeWidth: 2 };
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
            <Badge
              variant={
                data.connectionType === "success" ? "default" : "secondary"
              }
              className="text-xs"
            >
              {(data.label as string) ?? ""}
            </Badge>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
