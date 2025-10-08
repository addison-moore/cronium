"use client";

import React, { useState } from "react";
import { RefreshCw, FileText, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cronium/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActionMenu } from "@/components/ui/action-menu";
import { LogStatus } from "@/shared/schema";
import { Pagination } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { type Log } from "./types";
import { formatDate as formatDateUtil } from "@/lib/utils";

interface EventLogsTabProps {
  logs: Log[];
  totalLogs: number;
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  onRefresh?: () => void;
  itemsPerPage: number;
  onPageSizeChange: (size: number) => void;
}

export function EventLogsTab({
  logs,
  totalLogs,
  currentPage,
  totalPages,
  isLoading,
  onPageChange,
  onRefresh,
  itemsPerPage,
  onPageSizeChange,
}: EventLogsTabProps) {
  const t = useTranslations("Events");
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const [openQuickViewDialog, setOpenQuickViewDialog] = useState<number | null>(
    null,
  );

  const formatDate = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return t("never");
    return formatDateUtil(dateValue);
  };

  const formatDuration = (durationMs: number | null) => {
    if (durationMs === null) return "-";

    const seconds = durationMs / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(2)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const totalSeconds = seconds % 60;
    return `${hours}h ${remainingMinutes}m ${totalSeconds.toFixed(2)}s`;
  };

  const getStatusBadge = (status: string) => {
    const statusUpper = status.toUpperCase();

    switch (statusUpper) {
      case "SUCCESS":
        return <StatusBadge status={LogStatus.SUCCESS} size="sm" />;
      case "FAILURE":
      case "ERROR":
        return <StatusBadge status={LogStatus.FAILURE} size="sm" />;
      case "RUNNING":
        return <StatusBadge status={LogStatus.RUNNING} size="sm" />;
      case "TIMEOUT":
        return <StatusBadge status={LogStatus.TIMEOUT} size="sm" />;
      case "PARTIAL":
        return <StatusBadge status={LogStatus.PARTIAL} size="sm" />;
      case "PENDING":
        return <StatusBadge status={LogStatus.PENDING} size="sm" />;
      default:
        return <StatusBadge status="pending" label={status} size="sm" />;
    }
  };

  return (
    <Card className="bg-secondary-bg">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>{t("executionLogs")}</CardTitle>
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            onClick={onRefresh}
            disabled={isLoading}
            size="sm"
            className="ml-auto"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10">
            <FileText className="text-muted-foreground mb-4 h-16 w-16" />
            <p className="text-muted-foreground text-center">
              {t("noLogsFound")}
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell>{formatDate(log.startTime)}</TableCell>
                    <TableCell>{formatDuration(log.duration)}</TableCell>
                    <TableCell>
                      <ActionMenu
                        actions={[
                          {
                            label: "Quick View",
                            icon: <Eye className="h-4 w-4" />,
                            onClick: () => setOpenQuickViewDialog(log.id),
                          },
                          {
                            label: "View Details",
                            icon: <FileText className="h-4 w-4" />,
                            onClick: () =>
                              router.push(
                                `/${params.lang}/dashboard/logs/${log.id}`,
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
                      {(() => {
                        const log = logs.find(
                          (l) => l.id === openQuickViewDialog,
                        );
                        return log
                          ? `Execution Log - ${formatDate(log.startTime)}`
                          : "";
                      })()}
                    </DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="max-h-[60vh]">
                    {(() => {
                      const log = logs.find(
                        (l) => l.id === openQuickViewDialog,
                      );
                      if (!log) return null;

                      return (
                        <div className="space-y-4 p-4">
                          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                            <div>
                              <span className="font-medium">Status:</span>{" "}
                              {getStatusBadge(log.status)}
                            </div>
                            <div>
                              <span className="font-medium">
                                {t("started")}:
                              </span>{" "}
                              {formatDate(log.startTime)}
                            </div>
                            <div>
                              <span className="font-medium">{t("ended")}:</span>{" "}
                              {formatDate(log.endTime)}
                            </div>
                            <div>
                              <span className="font-medium">
                                {t("duration")}:
                              </span>{" "}
                              {formatDuration(log.duration)}
                            </div>
                          </div>

                          {log.output && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-medium">
                                {t("output")}:
                              </h4>
                              <pre className="bg-muted max-h-[300px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                                {typeof log.output === "object" &&
                                log.output !== null
                                  ? ((
                                      log.output as {
                                        combined?: string;
                                        stdout?: string;
                                      }
                                    ).combined ??
                                    (
                                      log.output as {
                                        combined?: string;
                                        stdout?: string;
                                      }
                                    ).stdout ??
                                    JSON.stringify(log.output, null, 2))
                                  : String(log.output)}
                              </pre>
                            </div>
                          )}

                          {log.error && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-medium">
                                {t("error")}:
                              </h4>
                              <pre className="max-h-[300px] overflow-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs whitespace-pre-wrap text-red-800">
                                {typeof log.error === "object" &&
                                log.error !== null
                                  ? JSON.stringify(log.error, null, 2)
                                  : String(log.error)}
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

            {totalLogs > 0 && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  {/* Items per page selector */}
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

                  {/* Pagination component */}
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={onPageChange}
                    itemsPerPage={itemsPerPage}
                    totalItems={totalLogs}
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
