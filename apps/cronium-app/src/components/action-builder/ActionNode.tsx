"use client";

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Card, CardContent } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Settings, AlertCircle, CheckCircle } from "lucide-react";
import { NodeType } from "./types";
import { cn } from "@/lib/utils";

export function ActionNode({ data, selected }: NodeProps) {
  const getNodeStyle = () => {
    switch (data.nodeType) {
      case NodeType.TRIGGER:
        return "border-blue-500 bg-blue-50 dark:bg-blue-950";
      case NodeType.ACTION:
        return "border-green-500 bg-green-50 dark:bg-green-950";
      case NodeType.CONDITION:
        return "border-yellow-500 bg-yellow-50 dark:bg-yellow-950";
      case NodeType.TRANSFORMER:
        return "border-purple-500 bg-purple-50 dark:bg-purple-950";
      case NodeType.OUTPUT:
        return "border-gray-500 bg-gray-50 dark:bg-gray-950";
      default:
        return "";
    }
  };

  const getHandlePositions = () => {
    const type = data.nodeType;
    const handles = [];

    // Input handle (except for triggers)
    if (type !== NodeType.TRIGGER) {
      handles.push(
        <Handle
          key="input"
          type="target"
          position={Position.Top}
          id="input"
          className="!bg-background !h-3 !w-3 !border-2"
        />,
      );
    }

    // Output handles
    if (type !== NodeType.OUTPUT) {
      if (type === NodeType.CONDITION) {
        // Condition nodes have multiple outputs
        handles.push(
          <Handle
            key="success"
            type="source"
            position={Position.Bottom}
            id="success"
            className="!h-3 !w-3 !border-2 !bg-green-500"
            style={{ left: "25%" }}
          />,
          <Handle
            key="failure"
            type="source"
            position={Position.Bottom}
            id="failure"
            className="!h-3 !w-3 !border-2 !bg-red-500"
            style={{ left: "75%" }}
          />,
        );
      } else {
        // Single output
        handles.push(
          <Handle
            key="output"
            type="source"
            position={Position.Bottom}
            id="output"
            className="!bg-background !h-3 !w-3 !border-2"
          />,
        );
      }
    }

    return handles;
  };

  return (
    <>
      {...getHandlePositions()}
      <Card
        className={cn(
          "min-w-[280px] border-2 transition-all",
          getNodeStyle(),
          selected && "ring-primary ring-2 ring-offset-2",
          !data.isConfigured && "border-dashed",
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{String(data.label)}</h3>
                {data.isConfigured ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                )}
              </div>
              {data.description && typeof data.description === "string" ? (
                <p className="text-muted-foreground text-xs">
                  {data.description}
                </p>
              ) : null}
              {data.toolId &&
              data.actionId &&
              typeof data.toolId === "string" &&
              typeof data.actionId === "string" ? (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {data.toolId}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {data.actionId}
                  </Badge>
                </div>
              ) : null}
            </div>
            <button
              className="hover:bg-muted rounded p-1"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Open configuration panel
              }}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
