"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText, RefreshCw, Eye } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cronium/ui";
import { Button } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { StandardizedTableLink } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Pagination } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import { ActionMenu } from "@/components/ui/action-menu";
import { type LogStatus } from "@/shared/schema";
import { Spinner } from "@cronium/ui";
import { format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@cronium/ui";

interface ActivityEntry {
  id: number;
  eventId: number;
  eventName: string;
  status: LogStatus;
  output?: string;
  error?: string;
  startTime: string;
  endTime?: string | null;
  duration: number | null;
  executionDuration?: number | null; // Actual script execution time in ms
  setupDuration?: number | null; // Setup phase time in ms
  workflowId?: number | null;
  workflowName?: string | null;
}

interface ActivityTableProps {
  title: string;
  description?: string;
  data: ActivityEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => Promise<void>;
  emptyStateMessage?: string;
  showPagination?: boolean;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (newPage: number) => void;
  itemsPerPage?: number;
  totalItems?: number;
  onPageSizeChange?: (newSize: number) => void;
  className?: string;
}

export function ActivityTable({
  title,
  description,
  data,
  isLoading,
  isRefreshing: externalIsRefreshing,
  onRefresh,
  emptyStateMessage = "No activity found",
  showPagination = false,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  itemsPerPage = 20,
  totalItems = 0,
  onPageSizeChange,
  className = "",
}: ActivityTableProps) {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const [internalIsRefreshing, setInternalIsRefreshing] = useState(false);
  const [openQuickViewDialog, setOpenQuickViewDialog] = useState<number | null>(
    null,
  );

  // Use external isRefreshing prop if provided, otherwise use internal state
  const isRefreshing = externalIsRefreshing ?? internalIsRefreshing;

  const handleRefresh = async () => {
    if (!onRefresh) return;

    setInternalIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setInternalIsRefreshing(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (durationMs: number | null | undefined) => {
    if (durationMs === null || durationMs === undefined) return "-";

    const seconds = durationMs / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(2)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
  };

  const formatDurationWithBreakdown = (activity: ActivityEntry) => {
    // If we have execution timing, show both with a tooltip
    if (
      activity.executionDuration !== undefined &&
      activity.executionDuration !== null
    ) {
      const execTime = formatDuration(activity.executionDuration);
      const totalTime = formatDuration(activity.duration);
      const setupTime = activity.setupDuration
        ? formatDuration(activity.setupDuration)
        : null;

      // Calculate other overhead (cleanup, etc.)
      const otherOverhead =
        activity.duration && activity.executionDuration
          ? activity.duration -
            activity.executionDuration -
            (activity.setupDuration || 0)
          : null;

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help space-y-1">
                <div className="font-medium">{execTime}</div>
                <div className="text-muted-foreground text-xs">
                  Total: {totalTime}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-2">
                <div className="font-semibold">Execution Breakdown</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <span>Script Execution:</span>
                    <span className="font-medium">{execTime}</span>
                  </div>
                  {setupTime && (
                    <div className="flex justify-between gap-4">
                      <span>Setup (container/SSH):</span>
                      <span className="text-muted-foreground">{setupTime}</span>
                    </div>
                  )}
                  {otherOverhead && otherOverhead > 0 && (
                    <div className="flex justify-between gap-4">
                      <span>Cleanup/Other:</span>
                      <span className="text-muted-foreground">
                        {formatDuration(otherOverhead)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 border-t pt-1">
                    <span>Total Duration:</span>
                    <span className="font-medium">{totalTime}</span>
                  </div>
                </div>
                <div className="text-muted-foreground text-xs italic">
                  Setup includes container creation, image pulls, or SSH
                  connection establishment
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    // Fall back to just showing total duration
    return formatDuration(activity.duration);
  };

  if (isLoading) {
    return (
      <Card className={`${className} bg-secondary-bg`}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" variant="primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${className} bg-secondary-bg`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            size="sm"
            className="ml-auto"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10">
            <FileText className="text-muted-foreground mb-4 h-16 w-16" />
            <p className="text-muted-foreground text-center">
              {emptyStateMessage}
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((activity) => (
                  <TableRow key={activity.id}>
                    <TableCell className="font-medium">
                      <StandardizedTableLink
                        href={`/${params.lang}/dashboard/events/${activity.eventId}`}
                      >
                        {activity.eventName}
                      </StandardizedTableLink>
                    </TableCell>
                    <TableCell>
                      {activity.workflowName ? (
                        <Badge variant="secondary" className="text-xs">
                          {activity.workflowName}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={activity.status} />
                    </TableCell>
                    <TableCell>{formatDate(activity.startTime)}</TableCell>
                    <TableCell>
                      {formatDurationWithBreakdown(activity)}
                    </TableCell>
                    <TableCell>
                      <ActionMenu
                        actions={[
                          {
                            label: "Quick View",
                            icon: <Eye className="h-4 w-4" />,
                            onClick: () => setOpenQuickViewDialog(activity.id),
                          },
                          {
                            label: "View Details",
                            icon: <FileText className="h-4 w-4" />,
                            onClick: () =>
                              router.push(
                                `/${params.lang}/dashboard/logs/${activity.id}`,
                              ),
                          },
                        ]}
                        menuButtonLabel="Actions"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Quick View Dialog */}
            {openQuickViewDialog && (
              <Dialog
                open={!!openQuickViewDialog}
                onOpenChange={(open) => !open && setOpenQuickViewDialog(null)}
              >
                <DialogContent className="max-h-[80vh] max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>
                      Log Details -{" "}
                      {(() => {
                        const activity = data.find(
                          (a) => a.id === openQuickViewDialog,
                        );
                        return activity
                          ? format(
                              new Date(activity.startTime),
                              "MMM d, yyyy HH:mm:ss",
                            )
                          : "";
                      })()}
                    </DialogTitle>
                    <DialogDescription>
                      {(() => {
                        const activity = data.find(
                          (a) => a.id === openQuickViewDialog,
                        );
                        return activity
                          ? `${activity.eventName} - Log #${activity.id}`
                          : "";
                      })()}
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="mt-4 max-h-[60vh]">
                    {(() => {
                      const activity = data.find(
                        (a) => a.id === openQuickViewDialog,
                      );
                      if (!activity) return null;

                      return (
                        <div className="space-y-4">
                          {/* Metadata */}
                          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                            <div>
                              <p className="text-muted-foreground text-sm">
                                Status
                              </p>
                              <StatusBadge status={activity.status} />
                            </div>
                            <div>
                              <p className="text-muted-foreground text-sm">
                                Start Time
                              </p>
                              <p className="text-sm font-medium">
                                {format(
                                  new Date(activity.startTime),
                                  "HH:mm:ss",
                                )}
                              </p>
                            </div>
                            {activity.endTime && (
                              <div>
                                <p className="text-muted-foreground text-sm">
                                  End Time
                                </p>
                                <p className="text-sm font-medium">
                                  {format(
                                    new Date(activity.endTime),
                                    "HH:mm:ss",
                                  )}
                                </p>
                              </div>
                            )}
                            {activity.duration && (
                              <div>
                                <p className="text-muted-foreground text-sm">
                                  Duration
                                </p>
                                <div className="text-sm font-medium">
                                  {activity.executionDuration !== undefined &&
                                  activity.executionDuration !== null ? (
                                    <div className="space-y-1">
                                      <div>
                                        Execution:{" "}
                                        {formatDuration(
                                          activity.executionDuration,
                                        )}
                                      </div>
                                      {activity.setupDuration !== undefined &&
                                        activity.setupDuration !== null && (
                                          <div className="text-muted-foreground text-xs">
                                            Setup:{" "}
                                            {formatDuration(
                                              activity.setupDuration,
                                            )}
                                          </div>
                                        )}
                                      <div className="text-muted-foreground text-xs">
                                        Total:{" "}
                                        {formatDuration(activity.duration)}
                                      </div>
                                    </div>
                                  ) : (
                                    formatDuration(activity.duration)
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Output */}
                          {activity.output && (
                            <div>
                              <h4 className="mb-2 text-sm font-medium">
                                Output
                              </h4>
                              <pre className="bg-muted max-h-[300px] overflow-x-auto overflow-y-auto rounded-md p-3 font-mono text-xs">
                                {activity.output}
                              </pre>
                            </div>
                          )}

                          {/* Error */}
                          {activity.error && (
                            <div>
                              <h4 className="text-destructive mb-2 text-sm font-medium">
                                Error
                              </h4>
                              <pre className="bg-destructive/10 border-destructive/50 text-destructive max-h-[300px] overflow-x-auto overflow-y-auto rounded-md border p-3 font-mono text-xs">
                                {activity.error}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            )}

            {/* Pagination Controls */}
            {showPagination && totalItems > 0 && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  {/* Items per page selector */}
                  {onPageSizeChange && (
                    <div className="flex items-center space-x-2">
                      <span className="text-muted-foreground text-sm">
                        Items per page:
                      </span>
                      <Select
                        value={itemsPerPage.toString()}
                        onValueChange={(value) =>
                          onPageSizeChange(parseInt(value))
                        }
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
                  )}

                  {/* Pagination component */}
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={onPageChange ?? (() => undefined)}
                    itemsPerPage={itemsPerPage}
                    totalItems={totalItems}
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
