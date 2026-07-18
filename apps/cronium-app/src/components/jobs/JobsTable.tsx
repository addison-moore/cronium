"use client";

import { type Job } from "@/shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Eye } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

interface JobsTableProps {
  jobs: Job[];
}

const priorityConfig = {
  0: { label: "Low", color: "secondary" },
  1: { label: "Normal", color: "default" },
  2: { label: "High", color: "warning" },
  3: { label: "Critical", color: "destructive" },
  low: { label: "Low", color: "secondary" },
  normal: { label: "Normal", color: "default" },
  high: { label: "High", color: "warning" },
  critical: { label: "Critical", color: "destructive" },
};

export function JobsTable({ jobs }: JobsTableProps) {
  const router = useRouter();

  const handleViewJob = (jobId: string) => {
    router.push(`/dashboard/jobs/${jobId}`);
  };

  if (jobs.length === 0) {
    return (
      <div className="text-muted-foreground p-8 text-center">No jobs found</div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const priority =
            priorityConfig[job.priority as keyof typeof priorityConfig] ??
            priorityConfig.normal;

          const duration =
            job.completedAt && job.startedAt
              ? new Date(job.completedAt).getTime() -
                new Date(job.startedAt).getTime()
              : null;

          return (
            <TableRow key={job.id}>
              <TableCell className="font-mono text-sm">{job.id}</TableCell>
              <TableCell className="capitalize">{job.type}</TableCell>
              <TableCell>
                <StatusBadge status={job.status} />
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    priority.color as
                      "secondary" | "default" | "warning" | "destructive"
                  }
                >
                  {priority.label}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(job.createdAt))} ago
              </TableCell>
              <TableCell className="text-muted-foreground">
                {duration ? `${Math.round(duration / 1000)}s` : "-"}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleViewJob(job.id)}
                >
                  <Eye className="mr-1 h-4 w-4" />
                  View
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
