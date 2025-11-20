"use client";

import React from "react";
import { useParams } from "next/navigation";
import { api } from "@/trpc/react";
import { LogDetailsSkeleton } from "@/components/logs/LogDetailsSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { formatDistanceToNow, format } from "date-fns";
import { CodeViewer } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { CalendarIcon, ClockIcon, ActivityIcon } from "lucide-react";

export default function LogDetails() {
  const params = useParams();
  const id = parseInt(params.id as string);

  const { data: log, isLoading } = api.logs.getById.useQuery(
    { id },
    { enabled: !isNaN(id) },
  );

  if (isLoading) {
    return <LogDetailsSkeleton />;
  }

  if (!log) {
    return (
      <div className="container mx-auto p-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">Log not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold">
                {log.eventName}
              </CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                Execution Log #{log.id}
              </p>
            </div>
            <StatusBadge status={log.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center text-sm">
                <CalendarIcon className="mr-2 h-4 w-4" />
                Start Time
              </div>
              <p className="font-medium">
                {format(new Date(log.startTime), "MMM d, yyyy HH:mm:ss")}
              </p>
              <p className="text-muted-foreground text-sm">
                {formatDistanceToNow(new Date(log.startTime), {
                  addSuffix: true,
                })}
              </p>
            </div>

            {log.endTime && (
              <div className="space-y-1">
                <div className="text-muted-foreground flex items-center text-sm">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  End Time
                </div>
                <p className="font-medium">
                  {format(new Date(log.endTime), "MMM d, yyyy HH:mm:ss")}
                </p>
              </div>
            )}

            {log.duration && (
              <div className="space-y-1">
                <div className="text-muted-foreground flex items-center text-sm">
                  <ClockIcon className="mr-2 h-4 w-4" />
                  Duration
                </div>
                <p className="font-medium">{formatDuration(log.duration)}</p>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center text-sm">
                <ActivityIcon className="mr-2 h-4 w-4" />
                Event ID
              </div>
              <p className="font-medium">#{log.eventId}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Execution Output */}
      {log.output && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Execution Output</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <CodeViewer
              code={log.output}
              language="text"
              className="rounded-none"
              showLineNumbers={log.output.split("\n").length > 5}
            />
          </CardContent>
        </Card>
      )}

      {/* Error Output */}
      {log.error && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive text-lg">
              Error Output
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Error details from the execution
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-destructive/20 border-t">
              <CodeViewer
                code={log.error}
                language="text"
                className="rounded-none border-0"
                theme="dark"
                showLineNumbers={log.error.split("\n").length > 5}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
