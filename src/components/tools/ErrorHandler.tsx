"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Copy,
  Download,
  Info,
  RefreshCw,
  RotateCcw,
  Shield,
  Terminal,
  XCircle,
  Zap,
  Activity,
  FileText,
  HelpCircle,
  Lightbulb,
  Send,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export interface ErrorInfo {
  code: string;
  message: string;
  timestamp: Date;
  severity: "low" | "medium" | "high" | "critical";
  category: "network" | "auth" | "validation" | "system" | "tool" | "unknown";
  details?: Record<string, unknown>;
  stack?: string;
  context?: {
    toolName?: string;
    actionName?: string;
    userId?: string;
    eventId?: number;
    workflowId?: number;
  };
  retry?: {
    attempted: number;
    maxAttempts: number;
    nextRetryAt?: Date;
    canRetry: boolean;
  };
  suggestions?: string[];
  documentation?: {
    title: string;
    url: string;
  }[];
}

interface ErrorHandlerProps {
  error: ErrorInfo;
  onRetry?: () => Promise<void>;
  onDismiss?: () => void;
  onReport?: (error: ErrorInfo) => void;
  showDetails?: boolean;
  compact?: boolean;
  className?: string;
}

// Error message transformations for better UX
const ERROR_TRANSFORMATIONS: Record<
  string,
  { title: string; message: string; suggestions: string[] }
> = {
  ECONNREFUSED: {
    title: "Connection Refused",
    message:
      "Unable to connect to the service. The server may be down or unreachable.",
    suggestions: [
      "Check if the service is running",
      "Verify the host and port are correct",
      "Check firewall settings",
      "Try again in a few moments",
    ],
  },
  ETIMEDOUT: {
    title: "Request Timeout",
    message: "The request took too long to complete and was cancelled.",
    suggestions: [
      "Check your internet connection",
      "The service may be experiencing high load",
      "Try breaking the operation into smaller parts",
      "Contact support if the issue persists",
    ],
  },
  ENOTFOUND: {
    title: "Service Not Found",
    message: "The specified service or domain could not be found.",
    suggestions: [
      "Check the URL or domain name",
      "Verify DNS settings",
      "Ensure you're connected to the internet",
    ],
  },
  "401": {
    title: "Authentication Failed",
    message: "Your credentials were rejected or have expired.",
    suggestions: [
      "Check your username and password",
      "Regenerate API tokens if needed",
      "Ensure your account has the required permissions",
      "Re-authenticate with the service",
    ],
  },
  "403": {
    title: "Access Denied",
    message: "You don't have permission to perform this action.",
    suggestions: [
      "Contact your administrator for access",
      "Check if your plan includes this feature",
      "Verify you're using the correct account",
    ],
  },
  "404": {
    title: "Resource Not Found",
    message: "The requested resource doesn't exist or has been moved.",
    suggestions: [
      "Verify the resource ID or path",
      "Check if the resource was deleted",
      "Ensure you have access to view this resource",
    ],
  },
  "429": {
    title: "Rate Limit Exceeded",
    message: "Too many requests. Please slow down.",
    suggestions: [
      "Wait before retrying",
      "Reduce the frequency of requests",
      "Consider upgrading your plan for higher limits",
      "Implement request batching",
    ],
  },
  "500": {
    title: "Server Error",
    message: "The service encountered an unexpected error.",
    suggestions: [
      "Try again in a few minutes",
      "Check the service status page",
      "Contact support if the issue persists",
    ],
  },
};

export default function ErrorHandler({
  error,
  onRetry,
  onDismiss,
  onReport,
  showDetails = true,
  compact = false,
  className,
}: ErrorHandlerProps) {
  const { toast } = useToast();
  const [isRetrying, setIsRetrying] = useState(false);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  // Get transformed error message
  const getTransformedError = () => {
    // Check for common error codes
    for (const [code, transformation] of Object.entries(
      ERROR_TRANSFORMATIONS,
    )) {
      if (
        error.code === code ||
        error.message.includes(code) ||
        (error.details &&
          "statusCode" in error.details &&
          String(error.details.statusCode) === code)
      ) {
        return transformation;
      }
    }

    // Default transformation
    return {
      title: "An Error Occurred",
      message: error.message,
      suggestions: error.suggestions ?? [],
    };
  };

  const transformedError = getTransformedError();

  // Handle retry with countdown
  useEffect(() => {
    if (error.retry?.nextRetryAt && error.retry.canRetry) {
      const interval = setInterval(() => {
        const now = new Date();
        const retryTime = new Date(error.retry!.nextRetryAt!);
        const secondsLeft = Math.max(
          0,
          Math.floor((retryTime.getTime() - now.getTime()) / 1000),
        );

        if (secondsLeft > 0) {
          setRetryCountdown(secondsLeft);
        } else {
          setRetryCountdown(null);
          clearInterval(interval);
        }
      }, 1000);

      return () => clearInterval(interval);
    }
    return undefined;
  }, [error.retry]);

  // Handle retry
  const handleRetry = async () => {
    if (!onRetry || isRetrying) return;

    setIsRetrying(true);
    try {
      await onRetry();
      toast({
        title: "Retry Successful",
        description: "The operation completed successfully.",
      });
    } catch {
      toast({
        title: "Retry Failed",
        description: "The operation failed again. Please try later.",
        variant: "destructive",
      });
    } finally {
      setIsRetrying(false);
    }
  };

  // Copy error details
  const copyErrorDetails = () => {
    const details = {
      error: {
        code: error.code,
        message: error.message,
        timestamp: error.timestamp,
        category: error.category,
        severity: error.severity,
        details: error.details,
        context: error.context,
      },
    };

    void navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    toast({
      title: "Copied",
      description: "Error details copied to clipboard",
    });
  };

  // Download error log
  const downloadErrorLog = () => {
    const log = {
      timestamp: error.timestamp,
      error: {
        code: error.code,
        message: error.message,
        category: error.category,
        severity: error.severity,
        stack: error.stack,
        details: error.details,
        context: error.context,
      },
      system: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      },
    };

    const blob = new Blob([JSON.stringify(log, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `error-${error.code}-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get severity color
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "low":
        return "text-blue-600 bg-blue-100";
      case "medium":
        return "text-yellow-600 bg-yellow-100";
      case "high":
        return "text-orange-600 bg-orange-100";
      case "critical":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  // Get category icon
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "network":
        return <Zap className="h-4 w-4" />;
      case "auth":
        return <Shield className="h-4 w-4" />;
      case "validation":
        return <AlertCircle className="h-4 w-4" />;
      case "system":
        return <Terminal className="h-4 w-4" />;
      case "tool":
        return <Activity className="h-4 w-4" />;
      default:
        return <HelpCircle className="h-4 w-4" />;
    }
  };

  if (compact) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{transformedError.title}</AlertTitle>
        <AlertDescription className="mt-2">
          <p>{transformedError.message}</p>
          <div className="mt-3 flex gap-2">
            {error.retry?.canRetry && onRetry && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetry}
                disabled={isRetrying || retryCountdown !== null}
              >
                {isRetrying ? (
                  <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-3 w-3" />
                )}
                {retryCountdown !== null
                  ? `Retry in ${retryCountdown}s`
                  : "Retry"}
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                {transformedError.title}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge
                  className={cn("text-xs", getSeverityColor(error.severity))}
                >
                  {error.severity}
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  {getCategoryIcon(error.category)}
                  {error.category}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {new Date(error.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={copyErrorDetails}
                aria-label="Copy error details"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadErrorLog}
                aria-label="Download error log"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Main Error Message */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{transformedError.message}</AlertDescription>
          </Alert>

          {/* Context Information */}
          {error.context && Object.keys(error.context).length > 0 && (
            <div className="bg-muted/50 rounded-lg border p-3">
              <h4 className="mb-2 text-sm font-medium">Context</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {error.context.toolName && (
                  <div>
                    <span className="text-muted-foreground">Tool:</span>{" "}
                    <span className="font-medium">
                      {error.context.toolName}
                    </span>
                  </div>
                )}
                {error.context.actionName && (
                  <div>
                    <span className="text-muted-foreground">Action:</span>{" "}
                    <span className="font-medium">
                      {error.context.actionName}
                    </span>
                  </div>
                )}
                {error.context.eventId && (
                  <div>
                    <span className="text-muted-foreground">Event ID:</span>{" "}
                    <span className="font-medium">
                      #{error.context.eventId}
                    </span>
                  </div>
                )}
                {error.context.workflowId && (
                  <div>
                    <span className="text-muted-foreground">Workflow ID:</span>{" "}
                    <span className="font-medium">
                      #{error.context.workflowId}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Retry Information */}
          {error.retry && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Retry Status</h4>
                <span className="text-muted-foreground text-sm">
                  {error.retry.attempted} / {error.retry.maxAttempts} attempts
                </span>
              </div>
              <Progress
                value={(error.retry.attempted / error.retry.maxAttempts) * 100}
                className="h-2"
              />
              {error.retry.nextRetryAt && (
                <p className="text-muted-foreground text-xs">
                  Next retry{" "}
                  {retryCountdown !== null
                    ? `in ${retryCountdown} seconds`
                    : `at ${new Date(error.retry.nextRetryAt).toLocaleTimeString()}`}
                </p>
              )}
            </div>
          )}

          {/* Suggestions */}
          {transformedError.suggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <Lightbulb className="h-4 w-4" />
                Suggestions
              </h4>
              <ul className="space-y-1">
                {transformedError.suggestions.map((suggestion, idx) => (
                  <li
                    key={idx}
                    className="text-muted-foreground flex items-start gap-2 text-sm"
                  >
                    <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Documentation Links */}
          {error.documentation && error.documentation.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                Related Documentation
              </h4>
              <div className="space-y-1">
                {error.documentation.map((doc, idx) => (
                  <Button
                    key={idx}
                    variant="link"
                    size="sm"
                    className="h-auto justify-start p-0 text-sm"
                    onClick={() => window.open(doc.url, "_blank")}
                  >
                    {doc.title}
                    <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Technical Details */}
          {showDetails && (
            <Accordion
              type="single"
              collapsible
              value={showFullDetails ? "details" : ""}
              onValueChange={(value) => setShowFullDetails(!!value)}
            >
              <AccordionItem value="details" className="border-0">
                <AccordionTrigger className="w-full justify-between hover:no-underline">
                  <span>Technical Details</span>
                </AccordionTrigger>
                <AccordionContent className="mt-2">
                  <Tabs defaultValue="details" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="details">Details</TabsTrigger>
                      <TabsTrigger value="stack">Stack Trace</TabsTrigger>
                      <TabsTrigger value="raw">Raw Error</TabsTrigger>
                    </TabsList>

                    <TabsContent value="details" className="mt-4">
                      <ScrollArea className="bg-muted/50 h-[200px] rounded-lg border p-3">
                        <pre className="text-xs">
                          {JSON.stringify(error.details ?? {}, null, 2)}
                        </pre>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="stack" className="mt-4">
                      <ScrollArea className="bg-muted/50 h-[200px] rounded-lg border p-3">
                        <pre className="font-mono text-xs">
                          {error.stack ?? "No stack trace available"}
                        </pre>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="raw" className="mt-4">
                      <ScrollArea className="bg-muted/50 h-[200px] rounded-lg border p-3">
                        <pre className="text-xs">
                          {JSON.stringify(
                            {
                              code: error.code,
                              message: error.message,
                              timestamp: error.timestamp,
                              category: error.category,
                              severity: error.severity,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </ScrollArea>
                    </TabsContent>
                  </Tabs>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {error.retry?.canRetry && onRetry && (
              <Button
                variant="default"
                size="sm"
                onClick={handleRetry}
                disabled={isRetrying || retryCountdown !== null}
              >
                {isRetrying ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                {retryCountdown !== null
                  ? `Retry in ${retryCountdown}s`
                  : "Retry Now"}
              </Button>
            )}

            {onReport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReportDialogOpen(true)}
              >
                <Send className="mr-2 h-4 w-4" />
                Report Issue
              </Button>
            )}

            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Issue</DialogTitle>
            <DialogDescription>
              Help us improve by reporting this error. Your report will include
              error details and system information.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The following information will be included in your report:
                <ul className="mt-2 list-inside list-disc text-sm">
                  <li>Error code and message</li>
                  <li>Timestamp and context</li>
                  <li>Browser and platform information</li>
                  <li>No personal data or credentials</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReportDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (onReport) {
                  onReport(error);
                  setReportDialogOpen(false);
                  toast({
                    title: "Issue Reported",
                    description: "Thank you for helping us improve.",
                  });
                }
              }}
            >
              Send Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
