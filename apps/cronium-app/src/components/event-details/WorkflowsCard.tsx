"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Button } from "@cronium/ui";
import {
  Workflow,
  Calendar,
  ArrowRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc";

interface WorkflowItem {
  id: number;
  name: string;
  description: string | null;
  status: string;
  triggerType: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  userId: string;
}

interface WorkflowsCardProps {
  eventId: number;
  eventLoaded?: boolean;
}

export default function WorkflowsCard({
  eventId,
  eventLoaded = true,
}: WorkflowsCardProps) {
  const router = useRouter();

  // tRPC query for fetching workflows that use this event
  const {
    data: workflowsData,
    isLoading: loading,
    error,
    refetch,
  } = trpc.events.getWorkflows.useQuery(
    { id: eventId },
    {
      enabled: eventLoaded,
      retry: (failureCount) => {
        // Retry up to 3 times on failure
        return failureCount < 3;
      },
      // Remove onError as it's not available in the new tRPC version
    },
  );

  const workflows: WorkflowItem[] = (workflowsData ?? []).map((w) => ({
    ...w,
    createdAt:
      w.createdAt instanceof Date ? w.createdAt.toISOString() : w.createdAt,
    updatedAt:
      w.updatedAt instanceof Date ? w.updatedAt.toISOString() : w.updatedAt,
  }));

  const handleViewWorkflow = (workflowId: number) => {
    router.push(`/dashboard/workflows/${workflowId}`);
  };

  const handleRetry = () => {
    void refetch();
  };

  const getTriggerTypeColor = (triggerType: string) => {
    switch (triggerType.toLowerCase()) {
      case "manual":
        return "bg-info/10 text-info-text border-info/40";
      case "scheduled":
        return "bg-primary/10 text-primary border-primary/40";
      case "webhook":
        return "bg-warning/10 text-warning-text border-warning/40";
      default:
        return "bg-muted/60 text-muted-foreground border-border";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Workflow className="h-5 w-5" />
            <span>Related Workflows</span>
          </CardTitle>
          <CardDescription>Workflows that use this event</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center">
            <div className="text-muted-foreground flex items-center space-x-2">
              <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
              <span>Loading workflows...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Workflow className="h-5 w-5" />
            <span>Related Workflows</span>
          </CardTitle>
          <CardDescription>Workflows that use this event</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 flex-col items-center justify-center space-y-4">
            <div className="text-center">
              <p className="text-muted-foreground mb-2 text-sm">
                Failed to load workflows
              </p>
              <p className="text-destructive text-xs">
                {error.message || "An error occurred"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="flex items-center space-x-2"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Retry</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Workflow className="h-5 w-5" />
          <span>Related Workflows</span>
        </CardTitle>
        <CardDescription>
          Workflows that use this event ({workflows.length})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {workflows.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <Workflow className="text-muted-foreground/40 mb-3 h-12 w-12" />
            <p className="text-muted-foreground mb-2 text-sm">
              No workflows found
            </p>
            <p className="text-muted-foreground text-xs">
              This event is not currently used in any workflows
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="border-border hover:bg-accent/50 rounded-lg border p-4 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center space-x-2">
                      <h4 className="truncate text-sm font-medium">
                        {workflow.name}
                      </h4>
                      <StatusBadge
                        status={workflow.status.toLowerCase()}
                        label={workflow.status}
                        size="sm"
                      />
                      <Badge
                        variant="outline"
                        className={getTriggerTypeColor(workflow.triggerType)}
                      >
                        {workflow.triggerType}
                      </Badge>
                    </div>

                    {workflow.description && (
                      <p className="text-muted-foreground mb-2 line-clamp-2 text-xs">
                        {workflow.description}
                      </p>
                    )}

                    <div className="text-muted-foreground flex items-center space-x-4 text-xs">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-3 w-3" />
                        <span>
                          Updated{" "}
                          {formatDistanceToNow(new Date(workflow.updatedAt))}{" "}
                          ago
                        </span>
                      </div>

                      {workflow.shared && (
                        <Badge variant="secondary" className="text-xs">
                          Shared
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewWorkflow(workflow.id)}
                    className="ml-2 flex items-center space-x-1"
                  >
                    <span className="text-xs">View</span>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}

            {workflows.length > 0 && (
              <div className="border-border border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/dashboard/workflows")}
                  className="w-full justify-center text-xs"
                >
                  <span>View All Workflows</span>
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
