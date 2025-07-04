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
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";

// Style definitions for different connection types
const connectionStyles = {
  [ConnectionType.ALWAYS]: {
    light: "#000000", // Black for light mode
    dark: "#ffffff", // White for dark mode
    label: "Always",
  },
  [ConnectionType.ON_SUCCESS]: {
    light: "#22c55e", // green-500 for light mode
    dark: "#4ade80", // green-400 for dark mode - slightly brighter for visibility
    label: "On Success",
  },
  [ConnectionType.ON_FAILURE]: {
    light: "#ef4444", // red-500 for light mode
    dark: "#f87171", // red-400 for dark mode - slightly brighter for visibility
    label: "On Failure",
  },
  [ConnectionType.ON_CONDITION]: {
    light: "#8b5cf6", // purple-500 for light mode
    dark: "#a78bfa", // purple-400 for dark mode - slightly brighter for visibility
    label: "On Condition",
  },
};

// Helper function to get class name based on connection type
const getConnectionClasses = (type: ConnectionType): string => {
  switch (type) {
    case ConnectionType.ALWAYS:
      return "border-black dark:border-white";
    case ConnectionType.ON_SUCCESS:
      return "border-green-500";
    case ConnectionType.ON_FAILURE:
      return "border-red-500";
    case ConnectionType.ON_CONDITION:
      return "border-purple-500";
    default:
      return "border-black dark:border-white";
  }
};

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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Get connection type from edge data or default to ALWAYS
  const connectionType =
    (data?.type as ConnectionType) || ConnectionType.ALWAYS;
  const connectionStyle = connectionStyles[connectionType];
  const { label } = connectionStyle;

  // Get the appropriate color based on the current theme
  const edgeColor = isDark ? connectionStyle.dark : connectionStyle.light;

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
      const currentEdges = getEdges();
      const updatedEdges = currentEdges.map((edge) => {
        if (edge.id === id) {
          return {
            ...edge,
            data: {
              ...edge.data,
              type: newType,
            },
          };
        }
        return edge;
      });

      setEdges(updatedEdges);
      setOpen(false);
    },
    [id, getEdges, setEdges],
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#arrowhead)"
        style={{
          stroke: edgeColor,
          strokeWidth: selected ? 2 : 1,
          strokeDasharray: "none", // All lines should be solid
        }}
      />

      {/* SVG Arrow Marker Definition */}
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker
            id="arrowhead"
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
              <Badge
                variant="outline"
                className={`h-5 cursor-pointer px-1.5 py-0 text-[10px] ${pathStyles} ${
                  connectionType === ConnectionType.ON_SUCCESS
                    ? "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"
                    : connectionType === ConnectionType.ON_FAILURE
                      ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                      : connectionType === ConnectionType.ON_CONDITION
                        ? "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400"
                        : "bg-gray-50 text-gray-600 dark:bg-gray-950 dark:text-gray-400"
                } ${selected ? "shadow-sm" : ""} hover:bg-accent hover:text-accent-foreground`}
              >
                {label}
              </Badge>
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
                  <span className="mr-2 h-2.5 w-2.5 rounded-full bg-black dark:bg-white" />
                  Always
                </Button>
                <Button
                  variant={
                    connectionType === ConnectionType.ON_SUCCESS
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="w-full justify-start text-left font-normal transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20 dark:hover:text-green-300"
                  onClick={() =>
                    updateConnectionType(ConnectionType.ON_SUCCESS)
                  }
                >
                  <span className="mr-2 h-2.5 w-2.5 rounded-full bg-green-500" />
                  On Success
                </Button>
                <Button
                  variant={
                    connectionType === ConnectionType.ON_FAILURE
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="w-full justify-start text-left font-normal transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                  onClick={() =>
                    updateConnectionType(ConnectionType.ON_FAILURE)
                  }
                >
                  <span className="mr-2 h-2.5 w-2.5 rounded-full bg-red-500" />
                  On Failure
                </Button>
                <Button
                  variant={
                    connectionType === ConnectionType.ON_CONDITION
                      ? "secondary"
                      : "ghost"
                  }
                  size="sm"
                  className="w-full justify-start text-left font-normal transition-colors hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-900/20 dark:hover:text-purple-300"
                  onClick={() =>
                    updateConnectionType(ConnectionType.ON_CONDITION)
                  }
                >
                  <span className="mr-2 h-2.5 w-2.5 rounded-full bg-purple-500" />
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
