"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Play, Activity, Info } from "lucide-react";
import { StatusIcon } from "@/components/ui/status-badge";
import { LogStatus } from "@/shared/schema";
import type { EventType } from "@/shared/schema";
import { EventDetailsPopover } from "@/components/ui/event-details-popover";
import { trpc } from "@/lib/trpc";
import {
  type LayoutNode,
  type NodeWithStatus,
  type WorkflowConnection,
  type WorkflowExecutionEvent,
  type WorkflowNode,
  buildConnectionPath,
  calculateExecutionLayout,
  computeCanvasBounds,
  deriveNodeStatuses,
  getNodeStatusClasses,
} from "./lib/execution-graph";

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

// Global cache for execution data to persist across tab switches and remounts
const executionCache = new Map<
  number,
  {
    events: WorkflowExecutionEvent[];
    execution: WorkflowExecution;
    timestamp: number;
  }
>();

const CACHE_DURATION = 30000; // 30 seconds

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of executionCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      executionCache.delete(key);
    }
  }
}, 60000); // Clean up every minute

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
  const lastNotifiedExecutionRef = React.useRef<{
    id: number;
    status: string;
  } | null>(null);
  const isMountedRef = React.useRef(true);

  // Track component mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Detect screen size for responsive layout
  useEffect(() => {
    const checkScreenSize = () => {
      setIsHorizontalLayout(window.innerWidth >= 768); // md breakpoint
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  // Use tRPC query for execution details
  const { data: executionData, refetch: refetchExecution } =
    trpc.workflows.getExecution.useQuery(
      {
        workflowId,
        executionId: executionId ?? 0,
      },
      {
        enabled: !!executionId && executionId > 0,
        refetchInterval: isExecuting ? 2000 : false, // Poll every 2 seconds when executing
        refetchOnWindowFocus: false, // Prevent refetch on focus to avoid cancelled queries
        refetchOnReconnect: false, // Prevent refetch on reconnect
        staleTime: 1000, // Keep data fresh for 1 second
        gcTime: 60000, // Keep data in cache for 60 seconds (formerly cacheTime)
        retry: (failureCount, error) => {
          // Don't retry on cancelled queries
          if (
            error instanceof Error &&
            (error.name === "CancelledError" ||
              error.message === "CancelledError")
          ) {
            return false;
          }
          // Don't retry on abort errors
          if (error instanceof Error && error.name === "AbortError") {
            return false;
          }
          return failureCount < 2;
        },
      },
    );

  // Process execution data when it changes
  useEffect(() => {
    if (executionData && isMountedRef.current) {
      // Extract events from the execution data
      const events =
        ((executionData as Record<string, unknown>)
          .events as WorkflowExecutionEvent[]) ?? [];
      setExecutionEvents(events);

      // Set current execution
      const execution = {
        id: executionData.id,
        workflowId: executionData.workflowId,
        status: executionData.status,
        startedAt:
          executionData.startedAt instanceof Date
            ? executionData.startedAt.toISOString()
            : (executionData.startedAt as string),
        completedAt:
          executionData.completedAt instanceof Date
            ? executionData.completedAt.toISOString()
            : (executionData.completedAt as string | null),
        totalDuration: executionData.totalDuration ?? null,
      };
      setCurrentExecution(execution);
      hasAnyDataRef.current = true;

      // Cache the execution data
      if (executionData.id) {
        executionCache.set(executionData.id, {
          events,
          execution,
          timestamp: Date.now(),
        });
      }

      // Update internal execution state based on actual status
      const isCompleted =
        executionData.status === LogStatus.SUCCESS ||
        executionData.status === LogStatus.FAILURE ||
        executionData.status === LogStatus.TIMEOUT ||
        executionData.status === LogStatus.PARTIAL;

      setActuallyExecuting(!isCompleted);
    }
  }, [executionData]);

  // Notify parent of execution update in a separate effect to prevent loops
  useEffect(() => {
    if (currentExecution && onExecutionUpdate) {
      // Only notify if execution has actually changed
      const lastNotified = lastNotifiedExecutionRef.current;
      if (
        lastNotified?.id !== currentExecution.id ||
        lastNotified.status !== (currentExecution.status as string)
      ) {
        onExecutionUpdate(currentExecution);
        lastNotifiedExecutionRef.current = {
          id: currentExecution.id,
          status: currentExecution.status,
        };
      }
    }
  }, [currentExecution, onExecutionUpdate]);

  // Function to manually refetch execution details
  const refetchExecutionDetails = useCallback(async () => {
    if (!executionId || !isMountedRef.current) return;

    try {
      // Only refetch if component is still mounted
      if (isMountedRef.current) {
        await refetchExecution();
      }
    } catch (error: unknown) {
      // Silently handle cancelled queries when component unmounts
      // TanStack Query throws errors with name property
      if (
        error instanceof Error &&
        (error.name === "CancelledError" || error.message === "CancelledError")
      ) {
        return;
      }
      // Also handle abort errors
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      // Log other errors but don't throw
      console.debug("WorkflowExecutionGraph refetch error:", error);
    }
  }, [executionId, refetchExecution]);

  // Update nodes with execution status
  useEffect(() => {
    setNodesWithStatus(deriveNodeStatuses(nodes, executionEvents));
  }, [nodes, executionEvents]);

  // Handle execution ID changes with debounced state management
  useEffect(() => {
    // Check if we have cached data for this execution
    if (executionId && executionCache.has(executionId)) {
      const cached = executionCache.get(executionId);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        // Restore cached data immediately to prevent flashing
        setExecutionEvents(cached.events);
        setCurrentExecution(cached.execution);
        hasAnyDataRef.current = true;

        // Set executing state based on cached execution status
        const isCompleted =
          cached.execution.status === LogStatus.SUCCESS ||
          cached.execution.status === LogStatus.FAILURE ||
          cached.execution.status === "completed" ||
          cached.execution.status === "failed";
        setActuallyExecuting(!isCompleted);
      }
    }

    // Only handle actual execution ID changes, not remounts with same ID
    if (executionId !== lastExecutionId) {
      // Clear any existing transition timeout
      if (stateTransitionTimeout) {
        clearTimeout(stateTransitionTimeout);
        setStateTransitionTimeout(null);
      }

      // Check if this is a new execution or just a remount
      const isNewExecution = executionId && executionId !== lastExecutionId;

      if (isNewExecution) {
        // Check cache first
        const cached = executionCache.get(executionId);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          // Use cached data
          setExecutionEvents(cached.events);
          setCurrentExecution(cached.execution);
          hasAnyDataRef.current = true;
        } else {
          // Clear old data for truly new executions
          setExecutionEvents([]);
          setCurrentExecution(null);
          hasAnyDataRef.current = false;
        }

        // Set executing state
        setActuallyExecuting(isExecuting);

        // Trigger refetch after a brief delay
        const timeout = setTimeout(() => {
          if (executionId && isMountedRef.current) {
            void refetchExecutionDetails();
          }
        }, 100);

        setStateTransitionTimeout(timeout);
      }

      setLastExecutionId(executionId);
    } else if (executionId && !hasAnyDataRef.current) {
      // Same execution ID but no data (e.g., after remount) - refetch without clearing
      void refetchExecutionDetails();
    }
  }, [
    executionId,
    lastExecutionId,
    isExecuting,
    stateTransitionTimeout,
    refetchExecutionDetails,
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

  // Note: Polling is now handled by the tRPC query's refetchInterval

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (stateTransitionTimeout) {
        clearTimeout(stateTransitionTimeout);
      }
    };
  }, [stateTransitionTimeout]);

  // Get status icon for a node (canonical mapping via StatusIcon)
  const getStatusIcon = (node: NodeWithStatus) => {
    const status = node.isCurrentlyExecuting
      ? LogStatus.RUNNING
      : (node.status ?? "pending");
    return <StatusIcon status={status} className="h-4 w-4" />;
  };

  // Draw connection lines between nodes
  const renderConnections = (layoutNodes: LayoutNode[]) => {
    return connections.map((conn) => {
      const sourceNode = layoutNodes.find((n) => n.id === conn.source);
      const targetNode = layoutNodes.find((n) => n.id === conn.target);

      if (!sourceNode || !targetNode) return null;

      const path = buildConnectionPath(
        sourceNode,
        targetNode,
        isHorizontalLayout,
      );

      return (
        <path
          key={`${conn.source}-${conn.target}`}
          d={path}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-muted-foreground"
          markerEnd="url(#arrowhead)"
        />
      );
    });
  };

  const layoutNodes = calculateExecutionLayout(
    nodesWithStatus,
    connections,
    isHorizontalLayout,
  );

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
                const { canvasWidth, canvasHeight, offsetX, offsetY } =
                  computeCanvasBounds(layoutNodes);

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
                          className={`absolute flex items-center justify-center rounded-md border px-1 py-1 transition-all duration-300 ${getNodeStatusClasses(node)} ${node.isCurrentlyExecuting || node.status === LogStatus.RUNNING ? "ring-opacity-50 ring-2 ring-blue-400 motion-safe:animate-pulse" : ""} `}
                          style={{
                            left: `${node.x + offsetX}px`,
                            top: `${node.y + offsetY}px`,
                            width: `${node.width}px`,
                            height: `${node.height}px`,
                          }}
                        >
                          <div className="flex w-full items-center gap-1 overflow-hidden">
                            <div className="relative shrink-0">
                              {getStatusIcon(node)}
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
              <div className="border-border mt-4 border-t pt-4">
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <StatusIcon
                      status={LogStatus.SUCCESS}
                      className="h-4 w-4"
                    />
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
                    <StatusIcon
                      status={LogStatus.FAILURE}
                      className="h-4 w-4"
                    />
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
                    <StatusIcon
                      status={LogStatus.RUNNING}
                      className="h-4 w-4"
                    />
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
                    <StatusIcon status="pending" className="h-4 w-4" />
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
