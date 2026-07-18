"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { type Job } from "@/shared/schema";
import { formatDistanceToNow } from "date-fns";
import { StatusBadge } from "@/components/ui/status-badge";

interface JobStatusCardProps {
  job: Job;
}

export function JobStatusCard({ job }: JobStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Job Status</span>
          <StatusBadge status={job.status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Created</span>
            <span>{formatDistanceToNow(new Date(job.createdAt))} ago</span>
          </div>

          {job.startedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Started</span>
              <span>{formatDistanceToNow(new Date(job.startedAt))} ago</span>
            </div>
          )}

          {job.completedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Completed</span>
              <span>{formatDistanceToNow(new Date(job.completedAt))} ago</span>
            </div>
          )}
        </div>

        {job.lastError && (
          <div className="bg-destructive/10 rounded-md p-3">
            <p className="text-destructive text-sm">{job.lastError}</p>
          </div>
        )}

        <div className="text-sm">
          <span className="text-muted-foreground">Attempts: </span>
          <span className="font-medium">{job.attempts}</span>
        </div>
      </CardContent>
    </Card>
  );
}
