"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, RefreshCw, Eye } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { StandardizedTableLink } from "@/components/ui/standardized-table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type LogStatus } from "@/shared/schema";
import { Spinner } from "@/components/ui/spinner";
import { format } from "date-fns";

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
  const [internalIsRefreshing, setInternalIsRefreshing] = useState(false);

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

  const formatDuration = (durationMs: number | null) => {
    if (durationMs === null) return "-";

    const seconds = durationMs / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(2)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
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
                    <TableCell>{formatDuration(activity.duration)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Eye className="mr-2 h-3 w-3" />
                              Quick View
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-h-[80vh] max-w-4xl">
                            <DialogHeader>
                              <DialogTitle>
                                Log Details -{" "}
                                {format(
                                  new Date(activity.startTime),
                                  "MMM d, yyyy HH:mm:ss",
                                )}
                              </DialogTitle>
                              <DialogDescription>
                                {activity.eventName} - Log #{activity.id}
                              </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="mt-4 max-h-[60vh]">
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
                                      <p className="text-sm font-medium">
                                        {formatDuration(activity.duration)}
                                      </p>
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
                            </ScrollArea>
                          </DialogContent>
                        </Dialog>
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={`/${params.lang}/dashboard/logs/${activity.id}`}
                            className="hover:text-primary transition-colors"
                          >
                            View Details
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

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
