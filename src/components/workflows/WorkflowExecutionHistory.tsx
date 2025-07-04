"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pagination } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { ComboBox } from "@/components/ui/combo-box";
import { formatDate } from "@/lib/utils";
import { Play, Search, X, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  LogStatus,
  WorkflowExecution,
  WorkflowExecutionEvent,
} from "@/shared/schema";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";

interface WorkflowExecutionHistoryProps {
  workflowId?: number; // Optional - if not provided, shows all workflows
  refreshTrigger?: number; // Trigger automatic refresh when this value changes
}

interface ExecutionWithEvents {
  execution: WorkflowExecution;
  events: WorkflowExecutionEvent[];
}

interface WorkflowExecutionWithWorkflow extends WorkflowExecution {
  workflow?: {
    id: number;
    name: string;
  };
}

export default function WorkflowExecutionHistory({
  workflowId,
  refreshTrigger,
}: WorkflowExecutionHistoryProps) {
  const params = useParams();
  const { toast } = useToast();
  const [selectedExecution, setSelectedExecution] =
    useState<ExecutionWithEvents | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "startedAt" | "completedAt">(
    "startedAt",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // tRPC query for workflow executions
  const {
    data: executionsData,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.workflows.getExecutions.useQuery(
    {
      id: workflowId,
      limit: 1000, // Get all executions for client-side filtering
      offset: 0,
    },
    {
      enabled: true,
      staleTime: 30000, // 30 seconds
      refetchInterval: (data) => {
        // Poll every 8 seconds if there are running executions
        const hasRunning = data?.executions?.some(
          (exec: any) => exec.status === LogStatus.RUNNING,
        );
        return hasRunning ? 8000 : false;
      },
    },
  );

  // Extract executions from tRPC response
  const executions = executionsData?.executions || [];
  const totalExecutions = executionsData?.total || 0;

  // Handle manual refresh
  const handleManualRefresh = async () => {
    if (isManualRefreshing) return;

    setIsManualRefreshing(true);
    try {
      await refetch();
      toast({
        title: "Refreshed",
        description: "Execution history updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to refresh execution history",
        variant: "destructive",
      });
    } finally {
      // Ensure manual refresh state lasts at least 500ms to prevent flashing
      setTimeout(() => setIsManualRefreshing(false), 500);
    }
  };

  // Fetch execution details
  const fetchExecutionDetails = async (executionId: number) => {
    try {
      setIsLoadingDetails(true);

      // Find the execution to get workflow ID
      const execution = executions.find((exec) => exec.id === executionId);
      const targetWorkflowId = workflowId || execution?.workflowId;

      if (!targetWorkflowId) {
        throw new Error(
          "Unable to determine workflow ID for execution details",
        );
      }

      // Use REST for now since we need the specific execution details endpoint
      // TODO: Add getExecutionDetails to tRPC workflows router
      const response = await fetch(
        `/api/workflows/${targetWorkflowId}/executions/${executionId}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch execution details");
      }

      const data = await response.json();
      setSelectedExecution(data.data);
    } catch (error) {
      console.error("Error fetching execution details:", error);
      toast({
        title: "Error",
        description: "Failed to fetch execution details",
        variant: "destructive",
      });
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Handle refresh trigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  // Prepare tag options for ComboBox (placeholder until workflows have tags)
  const tagOptions = [{ label: "All Tags", value: "all" }];

  // Status options for filter
  const statusOptions = [
    { label: "All Statuses", value: "all" },
    { label: "Running", value: LogStatus.RUNNING },
    { label: "Success", value: LogStatus.SUCCESS },
    { label: "Failed", value: LogStatus.FAILURE },
    { label: "Pending", value: LogStatus.PENDING },
    { label: "Paused", value: LogStatus.PAUSED },
  ];

  // Apply filters to executions
  const filteredExecutions = executions.filter((execution) => {
    const matchesSearch =
      execution.workflow?.name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ?? true;

    const matchesStatus =
      statusFilter === "all" || execution.status === statusFilter;

    // Tags filtering disabled until workflows have tags in schema
    const matchesTag = tagFilter === "all";

    return matchesSearch && matchesStatus && matchesTag;
  });

  // Apply sorting to filtered executions
  const sortedExecutions = [...filteredExecutions].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = (a.workflow?.name || "").localeCompare(
          b.workflow?.name || "",
        );
        break;
      case "startedAt":
        comparison =
          new Date(a.startedAt || 0).getTime() -
          new Date(b.startedAt || 0).getTime();
        break;
      case "completedAt":
        // If we're on a workflow detail page (workflowId exists), sort by duration
        // Otherwise, sort by completion date
        if (workflowId) {
          // Sort by duration (completed - started)
          const aDuration =
            a.completedAt && a.startedAt
              ? new Date(a.completedAt).getTime() -
                new Date(a.startedAt).getTime()
              : 0;
          const bDuration =
            b.completedAt && b.startedAt
              ? new Date(b.completedAt).getTime() -
                new Date(b.startedAt).getTime()
              : 0;
          comparison = aDuration - bDuration;
        } else {
          // Sort by completion date
          const aCompleted = a.completedAt
            ? new Date(a.completedAt).getTime()
            : 0;
          const bCompleted = b.completedAt
            ? new Date(b.completedAt).getTime()
            : 0;
          comparison = aCompleted - bCompleted;
        }
        break;
      default:
        comparison = 0;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });

  // Clear filters function
  const handleClearFilters = () => {
    setSearchTerm("");
    setTagFilter("all");
    setStatusFilter("all");
    setSortBy("startedAt");
    setSortOrder("desc");
    setCurrentPage(1);
  };

  // Calculate pagination for filtered results
  const totalFilteredItems = sortedExecutions.length;
  const totalFilteredPages = Math.ceil(totalFilteredItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedExecutions = sortedExecutions.slice(startIndex, endIndex);

  const getStatusBadge = (status: LogStatus) => {
    return <StatusBadge status={status} size="sm" />;
  };

  const formatDuration = (duration: number | null) => {
    if (!duration) return "N/A";

    const totalSeconds = duration / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      const remainingSeconds = totalSeconds % 60;
      return `${hours}h ${remainingMinutes}m ${remainingSeconds.toFixed(2)}s`;
    } else if (minutes > 0) {
      const remainingSeconds = totalSeconds % 60;
      return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
    } else {
      return `${totalSeconds.toFixed(2)}s`;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse">Loading execution history...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-5 w-5" />
          {workflowId ? "Execution History" : "Workflow Execution History"}
          <div className="ml-auto flex items-center gap-2">
            {isRefetching && !isManualRefreshing && (
              <div className="text-muted-foreground flex items-center gap-1 text-sm">
                <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"></div>
                Updating...
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isManualRefreshing}
              className="h-8"
            >
              <RefreshCw
                className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`}
              />
              {isManualRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filter Section */}
        <div className="mb-6">
          <div
            className={`grid grid-cols-1 md:grid-cols-2 ${workflowId ? "lg:grid-cols-3" : "lg:grid-cols-5"} gap-4`}
          >
            {/* Search - Only show on logs page (when workflowId is not provided) */}
            {!workflowId && (
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">
                  Search Workflows
                </label>
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
                  <Input
                    type="text"
                    placeholder="Search by workflow name..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="focus:ring-primary/20 h-10 rounded-md pl-10 transition-all focus:ring-2"
                  />
                </div>
              </div>
            )}

            {/* Sort By */}
            <div>
              <label className="text-foreground mb-1 block text-sm font-medium">
                Sort By
              </label>
              <div className="flex items-center space-x-2">
                <Select
                  value={sortBy}
                  onValueChange={(
                    value: "name" | "startedAt" | "completedAt",
                  ) => {
                    setSortBy(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="focus:ring-primary/20 text-foreground h-10 flex-1 rounded-md transition-all focus:ring-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border overflow-hidden rounded-md border shadow-lg">
                    {/* Conditional sort options based on page context */}
                    {!workflowId && (
                      <SelectItem
                        value="name"
                        className="hover:bg-muted text-foreground"
                      >
                        Workflow Name
                      </SelectItem>
                    )}
                    <SelectItem
                      value="startedAt"
                      className="hover:bg-muted text-foreground"
                    >
                      Start Time
                    </SelectItem>
                    {workflowId ? (
                      <SelectItem
                        value="completedAt"
                        className="hover:bg-muted text-foreground"
                      >
                        Duration
                      </SelectItem>
                    ) : (
                      <SelectItem
                        value="completedAt"
                        className="hover:bg-muted text-foreground"
                      >
                        Completion Date
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    setCurrentPage(1);
                  }}
                  className="border-border hover:bg-accent/50 h-10 w-10 p-0 transition-colors"
                  title={`Sort ${sortOrder === "asc" ? "Descending" : "Ascending"}`}
                >
                  {sortOrder === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="text-foreground mb-1 block text-sm font-medium">
                Status
              </label>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="focus:ring-primary/20 text-foreground h-10 w-full rounded-md transition-all focus:ring-2">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent className="bg-background border-border overflow-hidden rounded-md border shadow-lg">
                  {statusOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="hover:bg-muted text-foreground"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags - Only show on logs page (when workflowId is not provided) */}
            {!workflowId && (
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">
                  Tags
                </label>
                <ComboBox
                  options={tagOptions}
                  value={tagFilter}
                  onChange={(value) => {
                    setTagFilter(value);
                    setCurrentPage(1);
                  }}
                  placeholder="All Tags"
                  emptyMessage="No tags found"
                  className="w-full"
                />
              </div>
            )}

            {/* Clear Filters Button */}
            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="h-10 w-full"
              >
                <X className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            </div>
          </div>
        </div>

        {sortedExecutions.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {executions.length === 0
              ? workflowId
                ? "No executions found for this workflow."
                : "No workflow executions found."
              : "No executions match the current filters."}
          </div>
        ) : (
          <>
            <Table className="">
              <TableHeader>
                <TableRow>
                  {!workflowId && <TableHead>Workflow</TableHead>}
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedExecutions.map((execution) => (
                  <TableRow key={execution.id}>
                    {!workflowId && (
                      <TableCell>
                        <Link
                          href={`/${params.lang}/dashboard/workflows/${execution.workflowId}`}
                          className="hover:underline"
                        >
                          <div className="font-medium">
                            {execution.workflow?.name || "Unknown Workflow"}
                          </div>
                        </Link>
                      </TableCell>
                    )}
                    <TableCell>{formatDate(execution.startedAt)}</TableCell>
                    <TableCell>{getStatusBadge(execution.status)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{execution.triggerType}</Badge>
                    </TableCell>
                    <TableCell>
                      {formatDuration(execution.totalDuration)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <span className="text-green-600">
                          {execution.successfulEvents || 0}
                        </span>
                        <span>/</span>
                        <span className="text-red-600">
                          {execution.failedEvents || 0}
                        </span>
                        <span>/</span>
                        <span className="text-muted-foreground">
                          {execution.totalEvents || 0}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchExecutionDetails(execution.id)}
                          >
                            View Details
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[80vh] max-w-4xl">
                          <DialogHeader>
                            <DialogTitle>
                              Execution Details -{" "}
                              {execution.workflow?.name
                                ? `${execution.workflow.name} - `
                                : ""}
                              {formatDate(execution.startedAt)}
                            </DialogTitle>
                          </DialogHeader>
                          {isLoadingDetails ? (
                            <div className="flex items-center justify-center py-8">
                              <div className="animate-pulse">
                                Loading details...
                              </div>
                            </div>
                          ) : selectedExecution ? (
                            <ScrollArea className="h-[60vh]">
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className="text-sm font-medium">
                                      Status
                                    </label>
                                    <div className="mt-1">
                                      {getStatusBadge(
                                        selectedExecution.execution.status,
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium">
                                      Total Duration
                                    </label>
                                    <div className="mt-1">
                                      {formatDuration(
                                        selectedExecution.execution
                                          .totalDuration,
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  <label className="text-sm font-medium">
                                    Event Execution Timeline
                                  </label>
                                  <div className="mt-2 space-y-2">
                                    {selectedExecution.events.map(
                                      (event, index) => (
                                        <div
                                          key={event.id}
                                          className="border-border rounded border p-3"
                                        >
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <Link
                                                href={`/${params.lang}/dashboard/events/${event.eventId}`}
                                                className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                              >
                                                {(event as any).eventName ||
                                                  `Event ${event.eventId}`}
                                              </Link>
                                              {getStatusBadge(event.status)}
                                            </div>
                                            <div className="text-muted-foreground text-sm">
                                              {event.duration
                                                ? formatDuration(event.duration)
                                                : "N/A"}
                                            </div>
                                          </div>
                                          {event.connectionType && (
                                            <div className="mt-1">
                                              <Badge
                                                variant="outline"
                                                className="text-xs"
                                              >
                                                {event.connectionType}
                                              </Badge>
                                            </div>
                                          )}
                                          {event.output && (
                                            <div className="mt-2">
                                              <label className="text-xs font-medium">
                                                Output:
                                              </label>
                                              <pre className="bg-muted mt-1 overflow-x-auto rounded p-2 text-xs">
                                                {event.output}
                                              </pre>
                                            </div>
                                          )}
                                          {event.errorMessage && (
                                            <div className="mt-2">
                                              <label className="text-xs font-medium text-red-600">
                                                Error:
                                              </label>
                                              <pre className="mt-1 overflow-x-auto rounded bg-red-50 p-2 text-xs dark:bg-red-900/20">
                                                {event.errorMessage}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              </div>
                            </ScrollArea>
                          ) : null}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination Controls */}
            {totalFilteredItems > 0 && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  {/* Items per page selector */}
                  <div className="flex items-center space-x-2">
                    <span className="text-muted-foreground text-sm">
                      Items per page:
                    </span>
                    <Select
                      value={itemsPerPage.toString()}
                      onValueChange={(value) => {
                        setItemsPerPage(parseInt(value));
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Pagination component */}
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalFilteredPages}
                    onPageChange={(page) => setCurrentPage(page)}
                    itemsPerPage={itemsPerPage}
                    totalItems={totalFilteredItems}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
