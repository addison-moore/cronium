"use client";

import { useState, useEffect, use, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tab, Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { trpc } from "@/lib/trpc";
import WorkflowExecutionHistory from "@/components/workflows/WorkflowExecutionHistory";
import WorkflowExecutionGraph from "@/components/workflows/WorkflowExecutionGraph";
import WorkflowCanvas from "@/components/workflows/WorkflowCanvas-lazy";
import WorkflowDetailsForm from "@/components/workflows/WorkflowDetailsForm";
import { formatDate } from "@/lib/utils";
import {
  ArrowLeft,
  Share2,
  Clock,
  User,
  Calendar,
  Activity,
  Settings,
  MapPin,
  CheckCircle,
  XCircle,
  Globe,
  Zap,
  FileText,
  Link,
  Hash,
  Edit,
  GitFork,
} from "lucide-react";
import {
  type Workflow,
  type Event,
  EventStatus,
  type EventType,
  WorkflowTriggerType,
  type ConnectionType,
  LogStatus,
} from "@/shared/schema";
import type { Node, Edge } from "@xyflow/react";

// Type definitions for WorkflowCanvas integration
interface AvailableEvent {
  id: number;
  name: string;
  type: EventType;
  description?: string;
  tags?: string[];
  serverId?: number;
  serverName?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

interface WorkflowNodeData {
  eventId?: number;
  label?: string;
  type?: string;
  eventTypeIcon?: string;
  description?: string;
  tags?: string[];
  serverId?: number;
  serverName?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  updateEvents?: () => Promise<void>;
}

// Type guard for WorkflowNodeData
function isWorkflowNodeData(data: unknown): data is WorkflowNodeData {
  return typeof data === "object" && data !== null;
}
import { WorkflowDetailsHeader } from "@/components/workflow-details/WorkflowDetailsHeader";
import { StatusBadge } from "@/components/ui/status-badge";

interface WorkflowDetailsPageProps {
  params: Promise<{ id: string; lang: string }>;
}

export default function WorkflowDetailsPage({
  params,
}: WorkflowDetailsPageProps) {
  const resolvedParams = use(params);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  // Define types for workflow components
  interface LocalWorkflowNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
      eventId?: number;
      label?: string;
      type?: string;
      eventTypeIcon?: string;
      description?: string;
      tags?: string[];
      serverId?: number | undefined;
      serverName?: string;
      createdAt?: Date | string | undefined;
      updatedAt?: Date | string | undefined;
      updateEvents?: () => Promise<void>;
    };
  }

  interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    animated?: boolean;
    markerEnd?: { type: string };
  }

  interface WorkflowExecutionDetailed {
    id: number;
    workflowId: number;
    status: string;
    startedAt: Date | string;
    completedAt: Date | string | null;
    totalDuration: number | null;
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
  }

  interface ExecutionStats {
    totalExecutions: number;
    successCount: number;
    failureCount: number;
  }

  const [workflowNodes, setWorkflowNodes] = useState<LocalWorkflowNode[]>([]);
  const [workflowEdges, setWorkflowEdges] = useState<WorkflowEdge[]>([]);
  const [availableEvents, setAvailableEvents] = useState<Event[]>([]);
  const [currentExecution, setCurrentExecution] =
    useState<WorkflowExecutionDetailed | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [executionStats, setExecutionStats] = useState<ExecutionStats | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [hasInitialData, setHasInitialData] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [executionHistoryRefreshTrigger, setExecutionHistoryRefreshTrigger] =
    useState(0);
  const router = useRouter();
  const { toast } = useToast();

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "overview",
    validTabs: ["overview", "edit", "canvas", "execution-history"],
  });

  // Use tRPC queries
  const workflowId = parseInt(resolvedParams.id);
  const {
    data: workflowData,
    isLoading: isLoadingWorkflow,
    error: workflowError,
  } = trpc.workflows.getById.useQuery(
    { id: workflowId },
    {
      enabled: !isNaN(workflowId),
    },
  );

  // Handle workflow data
  useEffect(() => {
    if (workflowData) {
      setWorkflow(workflowData);
      // Define proper types for workflow data from tRPC
      interface WorkflowNode {
        id: number;
        eventId: number;
        position_x: number;
        position_y: number;
        event?: {
          id: number;
          name: string;
          type: string;
          description?: string;
          tags?: string[];
          serverId?: number | undefined;
          createdAt?: Date | string | undefined;
          updatedAt?: Date | string | undefined;
        };
      }

      interface WorkflowConnection {
        id: number;
        sourceNodeId: number;
        targetNodeId: number;
        connectionType?: string;
      }

      // Convert workflow nodes and connections to local format
      const typedNodes = workflowData.nodes as WorkflowNode[] | undefined;
      const nodes: LocalWorkflowNode[] = (typedNodes ?? []).map((node) => ({
        id: `node-${String(node.id)}`,
        type: "workflowNode",
        position: { x: node.position_x, y: node.position_y },
        data: {
          eventId: node.eventId,
          label: node.event?.name ?? "",
          type: node.event?.type ?? "",
          eventTypeIcon: node.event?.type ?? "",
          description: node.event?.description ?? "",
          tags: node.event?.tags ?? [],
          serverId: node.event?.serverId,
          createdAt: node.event?.createdAt ?? "",
          updatedAt: node.event?.updatedAt ?? "",
        },
      }));
      setWorkflowNodes(nodes);

      const typedConnections = workflowData.connections as
        | WorkflowConnection[]
        | undefined;
      const edges: WorkflowEdge[] = (typedConnections ?? []).map((conn) => ({
        id: `edge-${String(conn.id)}`,
        source: `node-${String(conn.sourceNodeId)}`,
        target: `node-${String(conn.targetNodeId)}`,
        type: conn.connectionType ?? "default",
        animated: false,
      }));
      setWorkflowEdges(edges);

      setHasInitialData(true);
      setHasUnsavedChanges(false);
    }
  }, [workflowData]);

  // Handle workflow error
  useEffect(() => {
    if (workflowError) {
      if (workflowError.data?.code === "NOT_FOUND") {
        router.push(`/${resolvedParams.lang}/dashboard/workflows`);
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch workflow details",
          variant: "destructive",
        });
      }
    }
  }, [workflowError, router, resolvedParams.lang, toast]);

  // Fetch execution statistics
  const { data: executionsData } = trpc.workflows.getExecutions.useQuery(
    { id: workflowId, limit: 100, offset: 0 },
    {
      enabled: !isNaN(workflowId),
    },
  );

  // Handle executions data
  useEffect(() => {
    if (executionsData?.executions) {
      const executions = executionsData.executions.executions || [];

      const stats: ExecutionStats = {
        totalExecutions: executions.length,
        successCount: executions.filter((e: unknown) => {
          if (typeof e === "object" && e !== null && "status" in e) {
            return (e as { status: string }).status === "completed";
          }
          return false;
        }).length,
        failureCount: executions.filter((e: unknown) => {
          if (typeof e === "object" && e !== null && "status" in e) {
            return (e as { status: string }).status === "failed";
          }
          return false;
        }).length,
      };
      setExecutionStats(stats);

      // Set current execution if there's a running one
      const runningExecution = executions.find((e: unknown) => {
        if (typeof e === "object" && e !== null && "status" in e) {
          return (e as { status: string }).status === "running";
        }
        return false;
      });
      if (runningExecution) {
        // Convert the execution data to match WorkflowExecutionDetailed interface
        const execution: WorkflowExecutionDetailed = {
          id: runningExecution.id,
          workflowId: runningExecution.workflowId,
          status: runningExecution.status,
          startedAt:
            runningExecution.startedAt instanceof Date
              ? runningExecution.startedAt.toISOString()
              : runningExecution.startedAt,
          completedAt: runningExecution.completedAt
            ? runningExecution.completedAt instanceof Date
              ? runningExecution.completedAt.toISOString()
              : runningExecution.completedAt
            : null,
          totalDuration: runningExecution.totalDuration ?? null,
          totalEvents: 0,
          successfulEvents: 0,
          failedEvents: 0,
        };
        setCurrentExecution(execution);
        setIsExecuting(true);
      } else {
        setIsExecuting(false);
      }
    }
  }, [executionsData]);

  // Combine loading states
  useEffect(() => {
    setIsLoading(isLoadingWorkflow);
  }, [isLoadingWorkflow]);

  // Use tRPC query for events
  const { data: eventsData, isLoading: isLoadingEvents } =
    trpc.events.getAll.useQuery({ limit: 100, offset: 0 });

  // Handle events data
  useEffect(() => {
    if (eventsData?.events) {
      setAvailableEvents(eventsData.events);
    }
  }, [eventsData]);

  useEffect(() => {
    setLoadingEvents(isLoadingEvents);
  }, [isLoadingEvents]);

  const fetchEvents = useCallback(async () => {
    // This is now handled by the tRPC query
    // Keeping the function for compatibility with components that expect it
    return Promise.resolve();
  }, []);

  // Update events function to refresh workflow nodes when events change
  const updateEvents = useCallback(async () => {
    try {
      console.log("Updating events...");
      await fetchEvents();
    } catch (error) {
      console.error("Error fetching events:", error);
      toast({
        title: "Error",
        description: "Failed to load events. Please try again.",
        variant: "destructive",
      });
    }
  }, [fetchEvents, toast]);

  const handleCanvasChange = useCallback(
    (nodes: LocalWorkflowNode[], edges: WorkflowEdge[]) => {
      if (!hasInitialData) return;

      setWorkflowNodes(nodes);
      setWorkflowEdges(edges);
      setHasUnsavedChanges(true);

      // Auto-save functionality removed - users must manually save canvas changes
    },
    [hasInitialData],
  );

  // Auto-save function removed - manual save only

  // Use tRPC mutation for saving
  const updateWorkflowMutation = trpc.workflows.update.useMutation({
    onSuccess: () => {
      setHasUnsavedChanges(false);
      toast({
        title: "Saved",
        description: "Workflow saved successfully",
      });
    },
    onError: (error) => {
      console.error("Save failed:", error);
      toast({
        title: "Error",
        description: "Failed to save workflow",
        variant: "destructive",
      });
    },
  });

  const handleManualSave = async () => {
    if (!workflow) return;

    setIsSaving(true);
    try {
      // Convert local nodes and edges back to tRPC format
      // The schema expects full node/edge data, but the server only uses eventId and connectionType
      const nodes = workflowNodes.map((node) => ({
        id: node.id,
        type: "eventNode" as const,
        position: node.position,
        data: {
          eventId: node.data.eventId ?? 0,
          label: node.data.label ?? "",
          type: node.data.type ?? "",
          eventTypeIcon: node.data.eventTypeIcon ?? "",
          description: node.data.description,
          tags: node.data.tags ?? [],
          serverId: node.data.serverId,
          serverName: node.data.serverName,
          createdAt: node.data.createdAt
            ? typeof node.data.createdAt === "string"
              ? node.data.createdAt
              : node.data.createdAt.toISOString()
            : undefined,
          updatedAt: node.data.updatedAt
            ? typeof node.data.updatedAt === "string"
              ? node.data.updatedAt
              : node.data.updatedAt.toISOString()
            : undefined,
        },
      }));

      const edges = workflowEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "connectionEdge" as const,
        animated: edge.animated ?? true,
        data: {
          type: (edge.type ?? "default") as ConnectionType,
          connectionType: (edge.type ?? "default") as ConnectionType,
        },
      }));

      await updateWorkflowMutation.mutateAsync({
        id: workflow.id,
        nodes,
        edges,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const utils = trpc.useContext();

  const handleCanvasRefresh = () => {
    // Refetch workflow data using tRPC
    void utils.workflows.getById.invalidate({ id: workflowId });
  };

  // Memoize enriched nodes to prevent infinite re-renders and update when events change
  const enrichedWorkflowNodes = useMemo(() => {
    return workflowNodes.map((node) => {
      // Find the corresponding event for this node
      const event = availableEvents.find((e) => e.id === node.data.eventId);

      if (event) {
        // Check if the event data has changed
        const eventDataChanged =
          node.data.label !== event.name ||
          node.data.type !== event.type ||
          node.data.eventTypeIcon !== event.type;

        if (!eventDataChanged && node.data.updateEvents === updateEvents) {
          return node; // Return existing node if nothing changed
        }

        // Update node with latest event data including all properties for EventDetailsPopover
        return {
          ...node,
          data: {
            ...node.data,
            label: event.name,
            type: event.type,
            eventTypeIcon: event.type,
            description: event.description ?? "",
            tags: event.tags ?? [],
            serverId: event.serverId,
            serverName: undefined, // serverName not available on Event type
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            updateEvents: updateEvents,
          },
        };
      }

      // For nodes without matching events, just add updateEvents function
      if (node.data.updateEvents === updateEvents) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          updateEvents: updateEvents,
        },
      };
    });
  }, [workflowNodes, availableEvents, updateEvents]);

  const handleExecutionUpdate = (execution: WorkflowExecutionDetailed) => {
    setCurrentExecution(execution);
    if (
      execution.status === "completed" ||
      execution.status === "failed" ||
      execution.status === "SUCCESS" ||
      execution.status === "FAILURE"
    ) {
      setIsExecuting(false);
      // Refresh execution statistics but don't reload entire workflow
      void fetchExecutionStats();
      // Trigger refresh of execution history tab
      setExecutionHistoryRefreshTrigger((prev) => prev + 1);
    }
  };

  // Create a compatible handler for the WorkflowExecutionGraph component
  const handleWorkflowExecutionUpdate = (execution: {
    id: number;
    workflowId: number;
    status: string;
    startedAt: string;
    completedAt: string | null;
    totalDuration: number | null;
  }) => {
    // Convert to WorkflowExecutionDetailed format
    const detailedExecution: WorkflowExecutionDetailed = {
      ...execution,
      totalEvents: 0,
      successfulEvents: 0,
      failedEvents: 0,
    };
    handleExecutionUpdate(detailedExecution);
  };

  // Poll for execution status using tRPC
  useEffect(() => {
    if (!isExecuting || !currentExecution?.id) return;

    const pollInterval = setInterval(() => {
      void (async () => {
        try {
          const execution = await utils.workflows.getExecution.fetch({
            workflowId: workflowId,
            executionId: currentExecution.id,
          });

          if (execution) {
            setCurrentExecution(execution);
            if (
              execution.status === LogStatus.SUCCESS ||
              execution.status === LogStatus.FAILURE ||
              execution.status === LogStatus.TIMEOUT ||
              execution.status === LogStatus.PARTIAL
            ) {
              setIsExecuting(false);
              void fetchExecutionStats();
              clearInterval(pollInterval);
            }
          }
        } catch (error) {
          console.error("Error polling execution status:", error);
        }
      })();
    }, 2000); // Poll every 2 seconds

    // Safety timeout to re-enable button after 5 minutes in case polling fails
    const safetyTimeout = setTimeout(() => {
      setIsExecuting(false);
      clearInterval(pollInterval);
    }, 300000); // 5 minutes

    return () => {
      clearInterval(pollInterval);
      clearTimeout(safetyTimeout);
    };
  }, [isExecuting, currentExecution?.id, workflowId, utils]);

  const fetchExecutionStats = async () => {
    // Refetch executions using tRPC
    void utils.workflows.getExecutions.invalidate({ id: workflowId });
  };

  // Use tRPC mutation for executing workflow
  const executeWorkflowMutation = trpc.workflows.execute.useMutation({
    onSuccess: (data) => {
      if (data.executionId) {
        const execution = {
          id: data.executionId,
          workflowId: workflow?.id ?? 0,
          status: "running",
          startedAt: new Date().toISOString(),
          completedAt: null,
          totalDuration: null,
          totalEvents: 0,
          successfulEvents: 0,
          failedEvents: 0,
        };

        setCurrentExecution(execution);

        toast({
          title: "Workflow Started",
          description: "Workflow execution has begun",
        });
      }
    },
    onError: (error) => {
      console.error("Error starting workflow:", error);
      setIsExecuting(false);
      toast({
        title: "Error",
        description: "Failed to start workflow execution",
        variant: "destructive",
      });
    },
  });

  const handleRunWorkflow = async () => {
    if (!workflow || isExecuting) return;

    setIsExecuting(true);
    await executeWorkflowMutation.mutateAsync({
      id: workflow.id,
      manual: true,
    });
  };

  // Use tRPC mutation for status change
  const updateStatusMutation = trpc.workflows.update.useMutation({
    onSuccess: (updatedWorkflow) => {
      if (updatedWorkflow) {
        setWorkflow(updatedWorkflow);
        const status = updatedWorkflow.status;
        toast({
          title: "Status Updated",
          description: `Workflow ${status === EventStatus.ACTIVE ? "activated" : status === EventStatus.PAUSED ? "paused" : "set to draft"}`,
        });
      }
    },
    onError: (error) => {
      console.error("Error updating workflow status:", error);
      toast({
        title: "Error",
        description: "Failed to update workflow status",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (!workflow) return;

    await updateStatusMutation.mutateAsync({
      id: workflow.id,
      status: newStatus,
    });
  };

  // Use tRPC mutation for deleting workflow
  const deleteWorkflowMutation = trpc.workflows.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Workflow Deleted",
        description: "Workflow has been successfully deleted",
      });
      router.push(`/${resolvedParams.lang}/dashboard/workflows`);
    },
    onError: (error) => {
      console.error("Error deleting workflow:", error);
      toast({
        title: "Error",
        description: "Failed to delete workflow",
        variant: "destructive",
      });
    },
  });

  const handleDeleteWorkflow = async () => {
    if (!workflow) return;

    if (
      !confirm(
        "Are you sure you want to delete this workflow? This action cannot be undone.",
      )
    ) {
      return;
    }

    await deleteWorkflowMutation.mutateAsync({ id: workflow.id });
  };

  // Remove manual fetching as tRPC queries handle this automatically

  // Auto-save timeout cleanup removed since auto-save is disabled

  const getTriggerBadge = (triggerType: WorkflowTriggerType) => {
    const triggerIcons = {
      [WorkflowTriggerType.SCHEDULE]: <Clock className="h-3 w-3" />,
      [WorkflowTriggerType.WEBHOOK]: <Share2 className="h-3 w-3" />,
      [WorkflowTriggerType.MANUAL]: <User className="h-3 w-3" />,
    };

    const triggerLabels = {
      [WorkflowTriggerType.SCHEDULE]: "Scheduled",
      [WorkflowTriggerType.WEBHOOK]: "Webhook",
      [WorkflowTriggerType.MANUAL]: "Manual",
    };

    return (
      <Badge variant="outline">
        {triggerIcons[triggerType]}
        <span className="ml-1">
          {triggerLabels[triggerType] ?? triggerType}
        </span>
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="animate-pulse">
          <div className="bg-muted mb-6 h-8 w-1/3 rounded"></div>
          <div className="space-y-4">
            <div className="bg-muted h-32 rounded"></div>
            <div className="bg-muted h-64 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold">Workflow Not Found</h1>
          <Button onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 py-6">
      {/* Header */}
      <WorkflowDetailsHeader
        workflow={workflow}
        langParam={resolvedParams.lang}
        onDelete={handleDeleteWorkflow}
        onRun={handleRunWorkflow}
        onStatusChange={handleStatusChange}
        isRunning={isExecuting}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-6">
        <TabsList>
          <Tab value="overview" icon={Activity} label="Overview" />
          <Tab value="edit" icon={Edit} label="Edit" />
          <Tab
            value="canvas"
            icon={GitFork}
            label="Canvas"
            iconClassName="rotate-90"
          />
          <Tab
            value="execution-history"
            icon={Clock}
            label="Execution History"
          />
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Workflow Execution Progress */}
          {/* @ts-expect-error - exactOptionalPropertyTypes compatibility issue with conditional spread */}
          <WorkflowExecutionGraph
            workflowId={workflow.id}
            nodes={enrichedWorkflowNodes.map((node) => ({
              id: node.id,
              type: node.type,
              position: node.position,
              data: {
                eventId: node.data.eventId ?? 0,
                label: node.data.label ?? "",
                type: node.data.type ?? "",
                eventTypeIcon: node.data.eventTypeIcon ?? "",
                description: node.data.description ?? "",
                tags: Array.isArray(node.data.tags) ? node.data.tags : [],
                ...(node.data.serverId !== null &&
                  node.data.serverId !== undefined && {
                    serverId: node.data.serverId,
                  }),
                ...(node.data.serverName && {
                  serverName: node.data.serverName,
                }),
                ...(node.data.createdAt && { createdAt: node.data.createdAt }),
                ...(node.data.updatedAt && { updatedAt: node.data.updatedAt }),
              },
            }))}
            connections={workflowEdges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              data: {
                connectionType: edge.type ?? "default",
              },
            }))}
            executionId={currentExecution?.id}
            isExecuting={isExecuting}
            onExecutionUpdate={handleWorkflowExecutionUpdate}
            updateEvents={updateEvents}
          />

          {/* Workflow Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Workflow Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Name:</span>
                    <span className="text-sm font-semibold">
                      {workflow.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Hash className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">ID:</span>
                    <span className="text-sm">{workflow.id}</span>
                  </div>
                  {workflow.description && (
                    <div className="flex items-start gap-2">
                      <FileText className="text-muted-foreground mt-1 h-4 w-4" />
                      <span className="text-sm font-medium">Description:</span>
                      <span className="text-muted-foreground text-sm">
                        {workflow.description}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Calendar className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Created:</span>
                    <span className="text-sm">
                      {formatDate(workflow.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Updated:</span>
                    <span className="text-sm">
                      {formatDate(workflow.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Trigger Type:</span>
                    {getTriggerBadge(workflow.triggerType)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Activity className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Status:</span>
                    <StatusBadge status={workflow.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Run Location:</span>
                    {workflow.overrideEventServers &&
                    Array.isArray(workflow.overrideServerIds) &&
                    workflow.overrideServerIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(workflow.overrideServerIds as number[]).map(
                          (serverId) => (
                            <Badge key={serverId} variant="outline">
                              Server {serverId}
                            </Badge>
                          ),
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline">Event execution servers</Badge>
                    )}
                  </div>
                  {workflow.shared && (
                    <div className="flex items-center gap-2">
                      <Globe className="text-muted-foreground h-4 w-4" />
                      <span className="text-sm font-medium">Visibility:</span>
                      <Badge variant="outline">
                        <Globe className="mr-1 h-3 w-3" />
                        Shared
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              {/* Execution Statistics */}
              {executionStats && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <Activity className="h-4 w-4" />
                      Execution Statistics
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium">Successful:</span>
                        <span className="text-sm font-bold text-green-600">
                          {executionStats.successCount ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-medium">Failed:</span>
                        <span className="text-sm font-bold text-red-600">
                          {executionStats.failureCount ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Hash className="text-muted-foreground h-4 w-4" />
                        <span className="text-sm font-medium">Total:</span>
                        <span className="text-sm font-bold">
                          {executionStats.totalExecutions ?? 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Schedule Configuration */}
          {workflow.triggerType === WorkflowTriggerType.SCHEDULE && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Schedule Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {workflow.customSchedule && (
                  <div className="flex items-center gap-2">
                    <Settings className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">
                      Custom Schedule:
                    </span>
                    <code className="bg-muted rounded px-2 py-1 text-sm">
                      {workflow.customSchedule}
                    </code>
                  </div>
                )}
                {workflow.scheduleNumber && workflow.scheduleUnit && (
                  <div className="flex items-center gap-2">
                    <Clock className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Interval:</span>
                    <span className="text-sm">
                      Every {workflow.scheduleNumber}{" "}
                      {workflow.scheduleUnit.toLowerCase()}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Webhook Configuration */}
          {workflow.webhookKey && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="h-5 w-5" />
                  Webhook Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Link className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm font-medium">Webhook Key:</span>
                    <code className="bg-muted rounded px-2 py-1 text-sm">
                      {workflow.webhookKey}
                    </code>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Webhook URL:</p>
                    <div className="bg-muted rounded p-3">
                      <code className="text-sm break-all">
                        {typeof window !== "undefined"
                          ? window.location.origin
                          : ""}
                        /api/webhooks/{workflow.webhookKey}
                      </code>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="edit" className="space-y-6">
          {workflow && (
            <WorkflowDetailsForm
              workflow={workflow}
              workflowNodes={enrichedWorkflowNodes}
              workflowEdges={workflowEdges}
              onUpdate={setWorkflow}
            />
          )}
        </TabsContent>

        <TabsContent
          value="canvas"
          className="h-[calc(100vh-12rem)] overflow-hidden"
        >
          <div className="bg-secondary-bg relative h-full w-full overflow-hidden p-0">
            <WorkflowCanvas
              availableEvents={availableEvents.map((event): AvailableEvent => {
                const mappedEvent: AvailableEvent = {
                  id: event.id,
                  name: event.name,
                  type: event.type,
                };

                if (event.description) {
                  mappedEvent.description = event.description;
                }

                if (Array.isArray(event.tags) && event.tags.length > 0) {
                  mappedEvent.tags = event.tags as string[];
                }

                if (event.serverId) {
                  mappedEvent.serverId = event.serverId;
                }

                mappedEvent.createdAt = event.createdAt;
                mappedEvent.updatedAt = event.updatedAt;

                return mappedEvent;
              })}
              initialNodes={enrichedWorkflowNodes.map(
                (node): Node => ({
                  id: node.id,
                  type: node.type,
                  position: node.position,
                  data: {
                    eventId: node.data.eventId,
                    label: node.data.label,
                    type: node.data.type,
                    eventTypeIcon: node.data.eventTypeIcon,
                    description: node.data.description,
                    tags: node.data.tags,
                    serverId: node.data.serverId,
                    serverName: node.data.serverName,
                    createdAt: node.data.createdAt,
                    updatedAt: node.data.updatedAt,
                    updateEvents: node.data.updateEvents,
                  },
                }),
              )}
              initialEdges={workflowEdges.map((edge): Edge => {
                const mappedEdge: Edge = {
                  id: edge.id,
                  source: edge.source,
                  target: edge.target,
                };

                if (edge.type !== undefined) {
                  mappedEdge.type = edge.type;
                }

                if (edge.animated !== undefined) {
                  mappedEdge.animated = edge.animated;
                }

                if (edge.markerEnd !== undefined) {
                  // @ts-expect-error - exactOptionalPropertyTypes: markerEnd type compatibility
                  mappedEdge.markerEnd = edge.markerEnd as Edge["markerEnd"];
                }

                return mappedEdge;
              })}
              onChange={(nodes: Node[], edges: Edge[]) => {
                // Convert back to our local types
                // @ts-expect-error - exactOptionalPropertyTypes: Node data type is unknown
                const localNodes: LocalWorkflowNode[] = nodes.map((node) => {
                  const nodeData = isWorkflowNodeData(node.data)
                    ? node.data
                    : ({} as WorkflowNodeData);
                  return {
                    id: node.id,
                    type: node.type ?? "",
                    position: node.position,
                    data: {
                      eventId: nodeData.eventId,
                      label: nodeData.label,
                      type: nodeData.type,
                      eventTypeIcon: nodeData.eventTypeIcon,
                      description: nodeData.description,
                      tags: nodeData.tags,
                      serverId: nodeData.serverId,
                      serverName: nodeData.serverName,
                      createdAt: nodeData.createdAt,
                      updatedAt: nodeData.updatedAt,
                      updateEvents: nodeData.updateEvents,
                    },
                  };
                });
                const localEdges: WorkflowEdge[] = edges.map((edge) => {
                  const localEdge: WorkflowEdge = {
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                  };

                  if (edge.type !== undefined) {
                    localEdge.type = edge.type;
                  }

                  if (edge.animated !== undefined) {
                    localEdge.animated = edge.animated;
                  }

                  if (edge.markerEnd !== undefined) {
                    // @ts-expect-error - exactOptionalPropertyTypes: markerEnd type compatibility
                    localEdge.markerEnd =
                      edge.markerEnd as WorkflowEdge["markerEnd"];
                  }

                  return localEdge;
                });
                handleCanvasChange(localNodes, localEdges);
              }}
              onRefresh={handleCanvasRefresh}
              updateEvents={updateEvents}
              isLoading={loadingEvents}
              onSave={handleManualSave}
              isSaving={isSaving}
              hasUnsavedChanges={hasUnsavedChanges}
            />
          </div>
        </TabsContent>

        <TabsContent value="execution-history">
          <WorkflowExecutionHistory
            workflowId={workflow.id}
            refreshTrigger={executionHistoryRefreshTrigger}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
