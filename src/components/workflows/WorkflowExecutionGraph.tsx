"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Loader2,
  Activity,
  Info,
} from "lucide-react";
import { LogStatus } from "@/shared/schema";
import type { EventType } from "@/shared/schema";
import { EventDetailsPopover } from "@/components/ui/event-details-popover";

interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    eventId: number;
    label: string;
    type: string;
    eventTypeIcon: string;
    description: string;
    tags?: string[];
    serverId?: number;
    serverName?: string;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  };
}

interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
  data: {
    connectionType: string;
  };
}

interface WorkflowExecutionEvent {
  id: number;
  nodeId: number;
  eventId: number;
  status: LogStatus;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  errorMessage: string | null;
  sequenceOrder: number;
}

interface WorkflowExecutionGraphProps {
  workflowId: number;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  executionId?: number;
  isExecuting?: boolean;
  onExecutionUpdate?: (execution: WorkflowExecution) => void;
  updateEvents?: () => void;
}

interface WorkflowExecution {
  id: number;
  workflowId: number;
  status: LogStatus | "completed" | "failed" | "running";
  startedAt: string;
  completedAt: string | null;
  totalDuration: number | null;
}

interface NodeWithStatus extends WorkflowNode {
  status: LogStatus;
  isCurrentlyExecuting: boolean;
  hasError: boolean;
  duration?: number | null;
  nodeId: number;
}

export default function WorkflowExecutionGraph({
  workflowId,
  nodes,
  connections,
  executionId,
  isExecuting = false,
  onExecutionUpdate,
  updateEvents,
}: WorkflowExecutionGraphProps) {
  const [executionEvents, setExecutionEvents] = useState<
    WorkflowExecutionEvent[]
  >([]);
  const [nodesWithStatus, setNodesWithStatus] = useState<NodeWithStatus[]>([]);
  const [lastExecutionId, setLastExecutionId] = useState<number | undefined>(
    undefined,
  );
  const [isHorizontalLayout, setIsHorizontalLayout] = useState(true);
  const [currentExecution, setCurrentExecution] =
    useState<WorkflowExecution | null>(null);
  const [actuallyExecuting, setActuallyExecuting] = useState(false);
  const [stateTransitionTimeout, setStateTransitionTimeout] =
    useState<NodeJS.Timeout | null>(null);
  const hasAnyDataRef = React.useRef(false);

  // Detect screen size for responsive layout
  useEffect(() => {
    const checkScreenSize = () => {
      setIsHorizontalLayout(window.innerWidth >= 768); // md breakpoint
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  // Use REST API for execution details since tRPC endpoint doesn't exist yet

  // Declare fetchExecutionEvents function for fetching execution details via REST API
  const fetchExecutionEvents = useCallback(
    async (_isPolling = false) => {
      if (!executionId) {
        return;
      }

      try {
        const response = await fetch(
          `/api/workflows/${workflowId}/executions/${executionId}`,
        );

        if (response.ok) {
          const data = (await response.json()) as {
            data?: {
              events?: WorkflowExecutionEvent[];
              execution?: WorkflowExecution;
            };
          };
          const events = data.data?.events ?? [];
          const execution = data.data?.execution;

          // Only update state if we're still working with the same execution ID
          if (executionId === lastExecutionId) {
            setExecutionEvents(events);
            setCurrentExecution(execution);
            hasAnyDataRef.current = true;

            // Update internal execution state based on actual status
            if (execution) {
              const isCompleted =
                execution.status === LogStatus.SUCCESS ||
                execution.status === LogStatus.FAILURE ||
                execution.status === "completed" ||
                execution.status === "failed";

              setActuallyExecuting(!isCompleted);
            }

            // Notify parent of execution update
            if (onExecutionUpdate && execution) {
              onExecutionUpdate(execution);
            }
          }
        }
      } catch {
        // Silently handle fetch errors to prevent state corruption
      } finally {
      }
    },
    [workflowId, executionId, lastExecutionId, onExecutionUpdate],
  );

  // Function to manually refetch execution details
  const refetchExecutionDetails = useCallback(() => {
    if (!executionId) return;
    void fetchExecutionEvents(false);
  }, [executionId, fetchExecutionEvents]);

  // Initial fetch of execution data when executionId changes
  useEffect(() => {
    // Fetch execution details via REST API
    if (
      executionId &&
      executionId === lastExecutionId &&
      !hasAnyDataRef.current
    ) {
      void fetchExecutionEvents(false);
    }
  }, [executionId, lastExecutionId, fetchExecutionEvents]);

  // Update nodes with execution status
  useEffect(() => {
    const updatedNodes: NodeWithStatus[] = nodes.map((node) => {
      const nodeId = parseInt(node.id);
      const executionEvent = executionEvents.find(
        (event) => event.nodeId === nodeId,
      );

      let status = LogStatus.PENDING;
      let isCurrentlyExecuting = false;
      let hasError = false;
      let duration = null;

      if (executionEvent) {
        status = executionEvent.status;
        isCurrentlyExecuting = status === LogStatus.RUNNING;
        hasError = status === LogStatus.FAILURE;
        duration = executionEvent.duration ?? null;
      }

      return {
        ...node,
        nodeId,
        status,
        isCurrentlyExecuting,
        hasError,
        duration,
      };
    });

    setNodesWithStatus(updatedNodes);
  }, [nodes, executionEvents]);

  // Handle execution ID changes with debounced state management
  useEffect(() => {
    if (executionId !== lastExecutionId) {
      // Clear any existing transition timeout
      if (stateTransitionTimeout) {
        clearTimeout(stateTransitionTimeout);
        setStateTransitionTimeout(null);
      }

      // Only reset state when switching to a different execution ID
      if (executionId && executionId !== lastExecutionId) {
        // Immediately set the executing state based on prop to prevent flashing
        setActuallyExecuting(isExecuting);

        // Use a debounced approach to clear old data and load new data
        const timeout = setTimeout(() => {
          setExecutionEvents([]);
          setCurrentExecution(null);
          hasAnyDataRef.current = false;

          // Trigger tRPC refetch or REST fetch
          if (executionId) {
            if (refetchExecutionDetails) {
              void refetchExecutionDetails();
            } else {
              void fetchExecutionEvents(false);
            }
          }
        }, 100); // Brief delay to prevent rapid state changes

        setStateTransitionTimeout(timeout);
      }
      setLastExecutionId(executionId);
    }
  }, [
    executionId,
    lastExecutionId,
    isExecuting,
    stateTransitionTimeout,
    refetchExecutionDetails,
    fetchExecutionEvents,
  ]);

  // Stabilize actuallyExecuting state to prevent rapid changes
  useEffect(() => {
    if (!currentExecution) {
      // No execution data yet, use the prop value
      setActuallyExecuting(isExecuting);
    } else if (isExecuting && !actuallyExecuting) {
      // Starting new execution
      setActuallyExecuting(true);
    } else if (!isExecuting && actuallyExecuting && currentExecution) {
      // Execution completed, check if execution data confirms completion
      const isCompleted =
        currentExecution.status === LogStatus.SUCCESS ||
        currentExecution.status === LogStatus.FAILURE ||
        currentExecution.status === "completed" ||
        currentExecution.status === "failed";
      if (isCompleted) {
        setActuallyExecuting(false);
      }
    }
  }, [isExecuting, currentExecution, actuallyExecuting]);

  // Poll for updates when execution is active using REST API fallback
  useEffect(() => {
    if (!isExecuting || !executionId) return;

    const interval = setInterval(() => void fetchExecutionEvents(true), 2000);
    return () => clearInterval(interval);
  }, [isExecuting, executionId, fetchExecutionEvents]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (stateTransitionTimeout) {
        clearTimeout(stateTransitionTimeout);
      }
    };
  }, [stateTransitionTimeout]);

  // Get status icon for a node
  const getStatusIcon = (node: NodeWithStatus) => {
    if (node.isCurrentlyExecuting) {
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    }

    switch (node.status) {
      case LogStatus.SUCCESS:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case LogStatus.FAILURE:
        return <XCircle className="h-4 w-4 text-red-500" />;
      case LogStatus.RUNNING:
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  // Get status color for a node
  const getStatusColor = (node: NodeWithStatus) => {
    if (node.isCurrentlyExecuting) {
      return "border-blue-500 bg-blue-50 dark:bg-blue-950 dark:border-blue-400 shadow-lg shadow-blue-200 dark:shadow-blue-900/50";
    }

    switch (node.status) {
      case LogStatus.SUCCESS:
        return "border-green-500 bg-green-50 dark:bg-green-950 dark:border-green-400";
      case LogStatus.FAILURE:
        return "border-red-500 bg-red-50 dark:bg-red-950 dark:border-red-400";
      case LogStatus.RUNNING:
        return "border-blue-500 bg-blue-50 dark:bg-blue-950 dark:border-blue-400 shadow-lg shadow-blue-200 dark:shadow-blue-900/50";
      default:
        return "border-gray-300 bg-gray-50 dark:bg-gray-800 dark:border-gray-600";
    }
  };

  // Define type for layout nodes
  interface LayoutNode extends NodeWithStatus {
    x: number;
    y: number;
    width: number;
    height: number;
    level: number;
  }

  // Draw connection lines between nodes
  const renderConnections = (layoutNodes: LayoutNode[]) => {
    return connections.map((conn) => {
      const sourceNode = layoutNodes.find((n) => n.id === conn.source);
      const targetNode = layoutNodes.find((n) => n.id === conn.target);

      if (!sourceNode || !targetNode) return null;

      let x1, y1, x2, y2, path;

      if (isHorizontalLayout) {
        // Horizontal layout: connections go from right side to left side
        x1 = sourceNode.x + sourceNode.width;
        y1 = sourceNode.y + sourceNode.height / 2;
        x2 = targetNode.x;
        y2 = targetNode.y + targetNode.height / 2;

        // Create a curved horizontal path
        const midX = (x1 + x2) / 2;
        path = `M ${x1} ${y1} Q ${midX} ${y1} ${midX} ${(y1 + y2) / 2} Q ${midX} ${y2} ${x2} ${y2}`;
      } else {
        // Vertical layout: connections go from bottom to top
        x1 = sourceNode.x + sourceNode.width / 2;
        y1 = sourceNode.y + sourceNode.height;
        x2 = targetNode.x + targetNode.width / 2;
        y2 = targetNode.y;

        // Create a curved vertical path
        const midY = (y1 + y2) / 2;
        path = `M ${x1} ${y1} Q ${x1} ${midY} ${(x1 + x2) / 2} ${midY} Q ${x2} ${midY} ${x2} ${y2}`;
      }

      return (
        <path
          key={`${conn.source}-${conn.target}`}
          d={path}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-gray-400 dark:text-gray-500"
          markerEnd="url(#arrowhead)"
        />
      );
    });
  };

  // Calculate layout positions for tree visualization
  const calculateLayout = (isHorizontal = true) => {
    if (nodesWithStatus.length === 0) return [];

    const nodeWidth = 140;
    const nodeHeight = 40;
    const spacing = isHorizontal ? 60 : 20;
    const levelSpacing = isHorizontal ? 180 : 60;

    // Build connection map for tree layout
    const connectionMap = new Map<string, string[]>();
    const incomingMap = new Map<string, string>();

    connections.forEach((conn) => {
      if (!connectionMap.has(conn.source)) {
        connectionMap.set(conn.source, []);
      }
      connectionMap.get(conn.source)!.push(conn.target);
      incomingMap.set(conn.target, conn.source);
    });

    // Find root nodes (no incoming connections)
    const rootNodes = nodesWithStatus.filter(
      (node) => !incomingMap.has(node.id),
    );

    // If no clear roots, treat all as roots (disconnected nodes)
    const startingNodes = rootNodes.length > 0 ? rootNodes : nodesWithStatus;

    const positioned = new Map<
      string,
      { x: number; y: number; level: number }
    >();
    const levelNodes = new Map<number, string[]>();
    const visited = new Set<string>();

    // BFS to assign levels
    const queue: { nodeId: string; level: number }[] = startingNodes.map(
      (node) => ({ nodeId: node.id, level: 0 }),
    );

    // Mark starting nodes as visited
    startingNodes.forEach((node) => visited.add(node.id));

    while (queue.length > 0) {
      const { nodeId, level } = queue.shift()!;

      if (positioned.has(nodeId)) continue;

      positioned.set(nodeId, { x: 0, y: 0, level });

      if (!levelNodes.has(level)) {
        levelNodes.set(level, []);
      }
      levelNodes.get(level)!.push(nodeId);

      // Add children to queue
      const children = connectionMap.get(nodeId) ?? [];
      children.forEach((childId) => {
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push({ nodeId: childId, level: level + 1 });
        }
      });
    }

    // Calculate positions for each level
    levelNodes.forEach((nodeIds, level) => {
      if (isHorizontal) {
        // Horizontal layout: levels go left to right, nodes in level go top to bottom
        const levelHeight =
          nodeIds.length * nodeHeight + (nodeIds.length - 1) * spacing;
        const startY = -levelHeight / 2;

        nodeIds.forEach((nodeId, index) => {
          const x = level * levelSpacing;
          const y = startY + index * (nodeHeight + spacing);
          positioned.set(nodeId, { x, y, level });
        });
      } else {
        // Vertical layout: levels go top to bottom, nodes in level go left to right
        const levelWidth =
          nodeIds.length * nodeWidth + (nodeIds.length - 1) * spacing;
        const startX = -levelWidth / 2;

        nodeIds.forEach((nodeId, index) => {
          const x = startX + index * (nodeWidth + spacing);
          const y = level * levelSpacing;
          positioned.set(nodeId, { x, y, level });
        });
      }
    });

    return nodesWithStatus.map((node) => {
      const pos = positioned.get(node.id) ?? { x: 0, y: 0, level: 0 };
      return {
        ...node,
        x: pos.x,
        y: pos.y,
        level: pos.level,
        width: nodeWidth,
        height: nodeHeight,
      };
    });
  };

  const layoutNodes = calculateLayout(isHorizontalLayout);

  if (nodes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Workflow Execution Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-8 text-center">
            No nodes configured in this workflow
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Workflow Execution Progress
          {actuallyExecuting && (
            <Badge variant="secondary" className="ml-2">
              <Play className="mr-1 h-3 w-3" />
              Executing
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {nodes.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            No workflow execution data available
          </div>
        ) : (
          <div className="relative">
            {/* SVG Tree Container */}
            <div className="max-h-[280px] overflow-auto">
              {(() => {
                // Calculate canvas dimensions
                const minX =
                  layoutNodes.length > 0
                    ? Math.min(...layoutNodes.map((n) => n.x))
                    : 0;
                const maxX =
                  layoutNodes.length > 0
                    ? Math.max(...layoutNodes.map((n) => n.x + n.width))
                    : 800;
                const minY =
                  layoutNodes.length > 0
                    ? Math.min(...layoutNodes.map((n) => n.y))
                    : 0;
                const maxY =
                  layoutNodes.length > 0
                    ? Math.max(...layoutNodes.map((n) => n.y + n.height))
                    : 400;

                const padding = 20;
                const canvasWidth = Math.max(400, maxX - minX + padding * 2);
                const canvasHeight = Math.max(200, maxY - minY + padding * 2);
                const offsetX = -minX + padding;
                const offsetY = -minY + padding;

                return (
                  <div
                    className="relative w-full"
                    style={{ minWidth: `${canvasWidth}px` }}
                  >
                    <svg
                      width={canvasWidth}
                      height={canvasHeight}
                      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                      className="overflow-visible"
                    >
                      {/* Arrow marker definition */}
                      <defs>
                        <marker
                          id="arrowhead"
                          markerWidth="10"
                          markerHeight="7"
                          refX="9"
                          refY="3.5"
                          orient="auto"
                        >
                          <polygon
                            points="0 0, 10 3.5, 0 7"
                            className="fill-gray-400 dark:fill-gray-500"
                          />
                        </marker>
                      </defs>

                      {/* Render connections */}
                      <g transform={`translate(${offsetX}, ${offsetY})`}>
                        {renderConnections(layoutNodes)}
                      </g>
                    </svg>

                    {/* Render nodes as HTML elements positioned absolutely */}
                    <div className="absolute inset-0">
                      {layoutNodes.map((node) => (
                        <div
                          key={node.id}
                          className={`absolute flex items-center justify-center rounded border px-1 py-1 transition-all duration-300 ${getStatusColor(node)} ${node.isCurrentlyExecuting || node.status === LogStatus.RUNNING ? "ring-opacity-50 animate-pulse ring-2 ring-blue-400" : ""} `}
                          style={{
                            left: `${node.x + offsetX}px`,
                            top: `${node.y + offsetY}px`,
                            width: `${node.width}px`,
                            height: `${node.height}px`,
                          }}
                        >
                          <div className="flex w-full items-center gap-1 overflow-hidden">
                            <div className="relative flex-shrink-0">
                              {getStatusIcon(node)}
                              {(node.isCurrentlyExecuting ||
                                node.status === LogStatus.RUNNING) && (
                                <>
                                  <div className="absolute -inset-1 animate-ping rounded-full border border-blue-400 opacity-75"></div>
                                  <div className="absolute -inset-2 animate-pulse rounded-full border border-blue-300 opacity-50"></div>
                                </>
                              )}
                            </div>
                            <span
                              className="min-w-0 flex-1 truncate text-xs leading-tight font-medium"
                              title={node.data.label}
                            >
                              {node.data.label}
                            </span>
                            {node.data.eventId && (
                              <EventDetailsPopover
                                eventId={node.data.eventId}
                                eventName={node.data.label || "Untitled"}
                                eventType={node.data.type as EventType}
                                {...(node.data.description
                                  ? { eventDescription: node.data.description }
                                  : {})}
                                {...(node.data.tags && node.data.tags.length > 0
                                  ? { eventTags: node.data.tags }
                                  : {})}
                                {...(node.data.serverId !== undefined
                                  ? { eventServerId: node.data.serverId }
                                  : {})}
                                {...(node.data.serverName
                                  ? { eventServerName: node.data.serverName }
                                  : {})}
                                {...(node.data.createdAt
                                  ? { createdAt: node.data.createdAt }
                                  : {})}
                                {...(node.data.updatedAt
                                  ? { updatedAt: node.data.updatedAt }
                                  : {})}
                                {...(updateEvents
                                  ? { onEventUpdated: () => updateEvents() }
                                  : {})}
                              >
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-4 w-4 p-0 opacity-70 transition-opacity hover:bg-white/20 hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Info className="h-3 w-3" />
                                </Button>
                              </EventDetailsPopover>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Execution summary */}
            {executionEvents.length > 0 && (
              <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>
                      {
                        executionEvents.filter(
                          (e) => e.status === LogStatus.SUCCESS,
                        ).length
                      }{" "}
                      completed
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span>
                      {
                        executionEvents.filter(
                          (e) => e.status === LogStatus.FAILURE,
                        ).length
                      }{" "}
                      failed
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Loader2 className="h-4 w-4 text-blue-500" />
                    <span>
                      {
                        executionEvents.filter(
                          (e) => e.status === LogStatus.RUNNING,
                        ).length
                      }{" "}
                      running
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span>
                      {nodesWithStatus.length - executionEvents.length} pending
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
