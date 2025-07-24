"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@cronium/ui";
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  RefreshCw,
  Copy,
  FileText,
} from "lucide-react";
import { useToast } from "@cronium/ui";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";

function getSeverityIcon(severity: "error" | "warning" | "info") {
  switch (severity) {
    case "error":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "warning":
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    case "info":
      return <CheckCircle className="h-5 w-5 text-blue-500" />;
  }
}

interface DiagnosticIssue {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  solution?: string;
  code?: string;
  timestamp: Date;
  toolId?: number;
  actionId?: string;
}

interface ToolErrorDiagnosticsProps {
  toolId?: number;
  compact?: boolean;
  onRefresh?: () => void;
}

export function ToolErrorDiagnostics({
  toolId,
  compact = false,
  onRefresh,
}: ToolErrorDiagnosticsProps) {
  const [isOpen, setIsOpen] = React.useState(!compact);
  const { toast } = useToast();

  // Fetch recent tool action logs with errors
  const {
    data: logsData,
    isLoading,
    refetch,
  } = trpc.toolActionLogs.getRecent.useQuery(
    {
      limit: 20,
      status: "FAILURE",
      ...(toolId && { toolId }),
    },
    {
      enabled: !!toolId || !compact,
    },
  );

  const logs = logsData?.logs ?? [];

  // Convert logs to diagnostic issues
  const diagnosticIssues: DiagnosticIssue[] = React.useMemo(() => {
    return logs.map((log) => {
      const solution = getSolutionForError(log.errorMessage ?? "");
      const issue: DiagnosticIssue = {
        id: log.id.toString(),
        severity: "error" as const,
        title: `${log.actionId} failed`,
        description: log.errorMessage ?? "Unknown error occurred",
        timestamp: log.createdAt,
        actionId: log.actionId,
      };

      // Only add optional properties if they have values
      if (solution) {
        issue.solution = solution;
      }
      if (!log.toolType && toolId) {
        issue.toolId = toolId;
      }

      return issue;
    });
  }, [logs, toolId]);

  const handleCopyError = async (issue: DiagnosticIssue) => {
    const text = `Error: ${issue.title}\nDescription: ${issue.description}\n${
      issue.solution ? `Solution: ${issue.solution}` : ""
    }`;

    await navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Error details have been copied",
    });
  };

  const handleRefresh = async () => {
    await refetch();
    onRefresh?.();
  };

  if (compact && diagnosticIssues.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {diagnosticIssues.length} Recent Issues
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Card>
            <CardContent className="p-4">
              <DiagnosticsContent
                issues={diagnosticIssues}
                onCopyError={handleCopyError}
              />
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Error Diagnostics
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-muted-foreground py-8 text-center">
            Loading diagnostics...
          </div>
        ) : diagnosticIssues.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
            <p className="text-muted-foreground">No recent errors detected</p>
          </div>
        ) : (
          <DiagnosticsContent
            issues={diagnosticIssues}
            onCopyError={handleCopyError}
          />
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticsContent({
  issues,
  onCopyError,
}: {
  issues: DiagnosticIssue[];
  onCopyError: (issue: DiagnosticIssue) => void;
}) {
  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-4">
        {issues.map((issue) => (
          <div
            key={issue.id}
            className="border-border space-y-3 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                {getSeverityIcon(issue.severity)}
                <div className="space-y-1">
                  <h4 className="font-medium">{issue.title}</h4>
                  <p className="text-muted-foreground text-sm">
                    {issue.description}
                  </p>
                  {issue.actionId && (
                    <p className="text-muted-foreground text-xs">
                      Action: {issue.actionId}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {format(issue.timestamp, "MMM d, HH:mm")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCopyError(issue)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {issue.solution && (
              <div className="bg-muted/50 rounded p-3">
                <p className="mb-1 text-sm font-medium">Suggested Solution:</p>
                <p className="text-muted-foreground text-sm">
                  {issue.solution}
                </p>
              </div>
            )}

            {issue.code && (
              <pre className="bg-muted/30 overflow-x-auto rounded p-3 text-xs">
                <code>{issue.code}</code>
              </pre>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// Helper function to suggest solutions based on error patterns
function getSolutionForError(error: string): string | undefined {
  const errorLower = error.toLowerCase();

  if (errorLower.includes("webhook") && errorLower.includes("invalid")) {
    return "Check that your webhook URL is correct and the webhook hasn't been deleted from the service.";
  }

  if (errorLower.includes("401") || errorLower.includes("unauthorized")) {
    return "Your credentials may have expired or been revoked. Try updating your authentication credentials.";
  }

  if (errorLower.includes("403") || errorLower.includes("forbidden")) {
    return "Check that your integration has the necessary permissions to perform this action.";
  }

  if (errorLower.includes("rate limit")) {
    return "You've hit the API rate limit. Wait a few minutes before trying again or upgrade your plan.";
  }

  if (errorLower.includes("timeout")) {
    return "The request took too long. Check your network connection or try again with smaller data.";
  }

  if (errorLower.includes("network") || errorLower.includes("econnrefused")) {
    return "Network connection failed. Check your internet connection and firewall settings.";
  }

  if (errorLower.includes("invalid") && errorLower.includes("parameter")) {
    return "One or more parameters are invalid. Check the action configuration and parameter values.";
  }

  return undefined;
}
