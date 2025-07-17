"use client";

import React from "react";
import { useParams } from "next/navigation";
import { api } from "@/trpc/react";
import { LogDetailsSkeleton } from "@/components/logs/LogDetailsSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import CodeViewer from "@/components/ui/code-viewer";
import { LogStatus } from "@/shared/schema";

export default function LogDetailsClient() {
  const params = useParams();
  const id = parseInt(params.id as string);

  const { data: log, isLoading } = api.logs.getById.useQuery(
    { id },
    { enabled: !isNaN(id) }
  );

  if (isLoading) {
    return <LogDetailsSkeleton />;
  }

  if (!log) {
    return (
      <div className="container mx-auto p-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Log not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Log #{log.id}</CardTitle>
            <Badge variant={log.status === LogStatus.SUCCESS ? "default" : "destructive"}>
              {log.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Event</p>
              <p className="font-medium">{log.eventName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Executed</p>
              <p className="font-medium">
                {formatDistanceToNow(new Date(log.startTime), { addSuffix: true })}
              </p>
            </div>
            {log.duration && (
              <div>
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="font-medium">{log.duration}ms</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {log.output && (
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeViewer code={log.output} language="text" />
          </CardContent>
        </Card>
      )}

      {log.error && (
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeViewer code={log.error} language="text" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}