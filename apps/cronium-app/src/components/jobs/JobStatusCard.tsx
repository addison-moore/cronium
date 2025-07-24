"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { type Job } from "@/shared/schema";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface JobStatusCardProps {
  job: Job;
}

const statusConfig = {
  queued: {
    label: "Queued",
    color: "secondary",
    icon: Clock,
  },
  claimed: {
    label: "Claimed",
    color: "default",
    icon: AlertCircle,
  },
  running: {
    label: "Running",
    color: "warning",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    color: "success",
    icon: CheckCircle,
  },
  failed: {
    label: "Failed",
    color: "destructive",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    color: "secondary",
    icon: XCircle,
  },
};

export function JobStatusCard({ job }: JobStatusCardProps) {
  const config = statusConfig[job.status] || statusConfig.queued;
  const Icon = config.icon;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Job Status</span>
          <Badge
            variant={
              config.color as
                | "secondary"
                | "default"
                | "warning"
                | "success"
                | "destructive"
            }
          >
            <Icon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>
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
