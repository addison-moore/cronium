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
import WorkflowExecutionHistory from "@/components/workflows/WorkflowExecutionHistory";
import WorkflowExecutionGraph from "@/components/workflows/WorkflowExecutionGraph";
import WorkflowCanvas from "@/components/workflows/WorkflowCanvas";
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
  EventStatus,
  WorkflowTriggerType,
} from "@/shared/schema";
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
  const [workflowNodes, setWorkflowNodes] = useState<any[]>([]);
  const [workflowEdges, setWorkflowEdges] = useState<any[]>([]);
  const [availableEvents, setAvailableEvents] = useState<any[]>([]);
  const [currentExecution, setCurrentExecution] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [executionStats, setExecutionStats] = useState<any>(null);
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

  const fetchWorkflow = async () => {
    try {
      setIsLoading(true);

      // Fetch workflow details
      const response = await fetch(`/api/workflows/${resolvedParams.id}`);

      if (!response.ok) {
        if (response.status === 404) {
          router.push(`/${resolvedParams.lang}/dashboard/workflows`);
          return;
        }
        throw new Error("Failed to fetch workflow");
      }

      const data = await response.json();
      const workflowData = data.workflow ?? data;
      setWorkflow(workflowData);
      setWorkflowNodes(data.nodes ?? []);
      setWorkflowEdges(data.edges ?? []);

      setHasInitialData(true);
      setHasUnsavedChanges(false);

      // Fetch execution statistics
      const executionsResponse = await fetch(
        `/api/workflows/${resolvedParams.id}/executions?limit=1000`,
      );
      if (executionsResponse.ok) {
        const executionsData = await executionsResponse.json();
        const executions = executionsData.executions ?? [];

        const stats = {
          totalExecutions: executions.length,
          successCount: executions.filter((e: any) => e.status === "completed")
            .length,
          failureCount: executions.filter((e: any) => e.status === "failed")
            .length,
        };
        setExecutionStats(stats);

        // Set current execution if there's a running one
        const runningExecution = executions.find(
          (e: any) => e.status === "running",
        );
        if (runningExecution) {
          setCurrentExecution(runningExecution);
          setIsExecuting(true);
        } else {
          // Ensure button is enabled if no running executions
          setIsExecuting(false);
        }
      }
    } catch (error) {
      console.error("Error fetching workflow:", error);
      toast({
        title: "Error",
        description: "Failed to fetch workflow details",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchEvents = useCallback(async () => {
    try {
      setLoadingEvents(true);
      const response = await fetch("/api/events");
      if (response.ok) {
        const data = await response.json();
        console.log("Events API response:", data); // Debug log
        // The API returns an array directly, not wrapped in an events property
        setAvailableEvents(Array.isArray(data) ? data : (data.events ?? []));
      }
    } catch (error) {
      console.error("Error fetching events:", error);
    } finally {
      setLoadingEvents(false);
    }
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
    (nodes: any[], edges: any[]) => {
      if (!hasInitialData) return;

      setWorkflowNodes(nodes);
      setWorkflowEdges(edges);
      setHasUnsavedChanges(true);

      // Auto-save functionality removed - users must manually save canvas changes
    },
    [hasInitialData],
  );

  // Auto-save function removed - manual save only

  const handleManualSave = async () => {
    if (!workflow) return;

    try {
      setIsSaving(true);
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nodes: workflowNodes,
          edges: workflowEdges,
        }),
      });

      if (response.ok) {
        setHasUnsavedChanges(false);
        toast({
          title: "Saved",
          description: "Workflow saved successfully",
        });
      } else {
        throw new Error("Failed to save workflow");
      }
    } catch (error) {
      console.error("Save failed:", error);
      toast({
        title: "Error",
        description: "Failed to save workflow",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCanvasRefresh = () => {
    fetchWorkflow();
  };

  // Memoize enriched nodes to prevent infinite re-renders and update when events change
  const enrichedWorkflowNodes = useMemo(() => {
    return workflowNodes.map((node) => {
      // Find the corresponding event for this node
      const event = availableEvents.find((e) => e.id === node.data.eventId);

      if (event) {
        // Check if the event data has changed
        const eventDataChanged =
          node.data.label !== event.name ??
          node.data.type !== event.type ??
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
            serverName: event.serverName,
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

  const handleExecutionUpdate = (execution: any) => {
    setCurrentExecution(execution);
    if (
      execution.status === "completed" ||
      execution.status === "failed" ||
      execution.status === "SUCCESS" ||
      execution.status === "FAILURE"
    ) {
      setIsExecuting(false);
      // Refresh execution statistics but don't reload entire workflow
      fetchExecutionStats();
      // Trigger refresh of execution history tab
      setExecutionHistoryRefreshTrigger((prev) => prev + 1);
    }
  };

  // Poll for execution status when a workflow is executing
  useEffect(() => {
    if (!isExecuting || !currentExecution?.id) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/workflows/${resolvedParams.id}/executions/${String(currentExecution.id)}`,
        );

        if (response.ok) {
          const data = await response.json();
          const execution = data.data?.execution;

          if (execution) {
            setCurrentExecution(execution);
            if (
              execution.status === "completed" ||
              execution.status === "failed" ||
              execution.status === "SUCCESS" ||
              execution.status === "FAILURE"
            ) {
              setIsExecuting(false);
              fetchExecutionStats();
              clearInterval(pollInterval);
            }
          }
        }
      } catch (error) {
        console.error("Error polling execution status:", error);
      }
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
  }, [isExecuting, currentExecution?.id, resolvedParams.id]);

  const fetchExecutionStats = async () => {
    try {
      const executionsResponse = await fetch(
        `/api/workflows/${resolvedParams.id}/executions?limit=1000`,
      );
      if (executionsResponse.ok) {
        const executionsData = await executionsResponse.json();
        const executions = executionsData.executions ?? [];

        const stats = {
          totalExecutions: executions.length,
          successCount: executions.filter((e: any) => e.status === "completed")
            .length,
          failureCount: executions.filter((e: any) => e.status === "failed")
            .length,
        };
        setExecutionStats(stats);
      }
    } catch (error) {
      console.error("Error fetching execution stats:", error);
    }
  };

  const handleRunWorkflow = async () => {
    if (!workflow ?? isExecuting) return;

    try {
      setIsExecuting(true);
      const response = await fetch(`/api/workflows/${workflow.id}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to start workflow execution");
      }

      const data = await response.json();

      // Create execution object from response data
      const execution = {
        id: data.executionId,
        workflowId: workflow.id,
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
    } catch (error) {
      console.error("Error starting workflow:", error);
      setIsExecuting(false);
      toast({
        title: "Error",
        description: "Failed to start workflow execution",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (!workflow) return;

    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update workflow status");
      }

      const updatedWorkflow = await response.json();
      setWorkflow(updatedWorkflow.workflow ?? updatedWorkflow);

      toast({
        title: "Status Updated",
        description: `Workflow ${newStatus === EventStatus.ACTIVE ? "activated" : newStatus === EventStatus.PAUSED ? "paused" : "set to draft"}`,
      });
    } catch (error) {
      console.error("Error updating workflow status:", error);
      toast({
        title: "Error",
        description: "Failed to update workflow status",
        variant: "destructive",
      });
      throw error; // Re-throw to allow the clickable badge to handle the error state
    }
  };

  const handleDeleteWorkflow = async () => {
    if (!workflow) return;

    if (
      !confirm(
        "Are you sure you want to delete this workflow? This action cannot be undone.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete workflow");
      }

      toast({
        title: "Workflow Deleted",
        description: "Workflow has been successfully deleted",
      });

      router.push(`/${resolvedParams.lang}/dashboard/workflows`);
    } catch (error) {
      console.error("Error deleting workflow:", error);
      toast({
        title: "Error",
        description: "Failed to delete workflow",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchWorkflow();
    fetchEvents();
  }, [resolvedParams.id]);

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
          <WorkflowExecutionGraph
            workflowId={workflow.id}
            nodes={enrichedWorkflowNodes}
            connections={workflowEdges}
            executionId={currentExecution?.id}
            isExecuting={isExecuting}
            onExecutionUpdate={handleExecutionUpdate}
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
                        {workflow.overrideServerIds.map((serverId: number) => (
                          <Badge key={serverId} variant="outline">
                            Server {serverId}
                          </Badge>
                        ))}
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
          <div className="bg-secondary-bg relative h-[calc(100%-4rem)] h-full w-full overflow-hidden p-0">
            <WorkflowCanvas
              availableEvents={availableEvents}
              initialNodes={enrichedWorkflowNodes}
              initialEdges={workflowEdges}
              onChange={handleCanvasChange}
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
