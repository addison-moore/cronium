"use client";

import { memo, useState, useCallback } from "react";
import {
  type EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
} from "@xyflow/react";
import { ConnectionType } from "@/shared/schema";
import { Badge } from "@cronium/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@cronium/ui";
import { Button } from "@cronium/ui";
import {
  connectionStyles,
  getConnectionClasses,
  setEdgeConnectionType,
} from "../lib/connection-edge-style";

function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const { getEdges, setEdges } = useReactFlow();
  const [open, setOpen] = useState(false);

  // The edge's condition lives at `data.connectionType` — the single name used
  // by the canvas, the load/save transforms, and `workflow_connections`. Do not
  // reintroduce a `data.type` alias: it shadowed this value (so the badge kept
  // reading "Always" after the user picked another condition), and it reads as
  // React Flow's own `edge.type` ("connectionEdge"), which is a different thing.
  const connectionType =
    (data?.connectionType as ConnectionType) ?? ConnectionType.ALWAYS;
  const connectionStyle = connectionStyles[connectionType];
  const { label } = connectionStyle;

  // Get the appropriate color based on the current theme
  const edgeColor = connectionStyle.color;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const pathStyles = getConnectionClasses(connectionType);

  // Handler for updating the connection type
  const updateConnectionType = useCallback(
    (newType: ConnectionType) => {
      const updatedEdges = setEdgeConnectionType(getEdges(), id, newType);

      setEdges(updatedEdges);
      setOpen(false);
    },
    [id, getEdges, setEdges],
  );

  // Create a unique marker ID for this edge to ensure correct color
  const markerId = `arrowhead-${id}`;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          stroke: edgeColor,
          strokeWidth: selected ? 2 : 1,
          strokeDasharray: "none", // All lines should be solid
        }}
      />

      {/* SVG Arrow Marker Definition - Unique per edge */}
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker
            id={markerId}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={edgeColor} />
          </marker>
        </defs>
      </svg>

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              {/* Opaque backing so the edge line passes behind the label,
                  not through the translucent tint */}
              <div className="bg-background rounded-full">
                <Badge
                  variant="outline"
                  className={`h-5 cursor-pointer px-1.5 py-0 text-[10px] ${pathStyles} ${
                    connectionType === ConnectionType.ON_SUCCESS
                      ? "bg-success/10 text-success-text"
                      : connectionType === ConnectionType.ON_FAILURE
                        ? "bg-destructive/10 text-destructive-text"
                        : connectionType === ConnectionType.ON_CONDITION
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/60 text-muted-foreground"
                  } ${selected ? "shadow-sm" : ""} hover:bg-accent hover:text-accent-foreground`}
                >
                  {label}
                </Badge>
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1">
              <div className="space-y-1">
                <Button
                  variant={
                    connectionType === ConnectionType.ALWAYS
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="hover:bg-accent hover:text-accent-foreground w-full justify-start text-left font-normal transition-colors"
                  onClick={() => updateConnectionType(ConnectionType.ALWAYS)}
                >
                  <span className="bg-foreground mr-2 h-2.5 w-2.5 rounded-full" />
                  Always
                </Button>
                <Button
                  variant={
                    connectionType === ConnectionType.ON_SUCCESS
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="hover:bg-success/10 hover:text-success-text w-full justify-start text-left font-normal transition-colors"
                  onClick={() =>
                    updateConnectionType(ConnectionType.ON_SUCCESS)
                  }
                >
                  <span className="bg-success mr-2 h-2.5 w-2.5 rounded-full" />
                  On Success
                </Button>
                <Button
                  variant={
                    connectionType === ConnectionType.ON_FAILURE
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="hover:bg-destructive/10 hover:text-destructive-text w-full justify-start text-left font-normal transition-colors"
                  onClick={() =>
                    updateConnectionType(ConnectionType.ON_FAILURE)
                  }
                >
                  <span className="bg-destructive mr-2 h-2.5 w-2.5 rounded-full" />
                  On Failure
                </Button>
                <Button
                  variant={
                    connectionType === ConnectionType.ON_CONDITION
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="hover:bg-primary/10 hover:text-primary w-full justify-start text-left font-normal transition-colors"
                  onClick={() =>
                    updateConnectionType(ConnectionType.ON_CONDITION)
                  }
                >
                  <span className="bg-primary mr-2 h-2.5 w-2.5 rounded-full" />
                  On Condition
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(ConnectionEdge);
