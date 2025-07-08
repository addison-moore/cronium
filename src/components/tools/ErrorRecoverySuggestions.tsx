"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Copy,
  ExternalLink,
  HelpCircle,
  Info,
  Lightbulb,
  PlayCircle,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
  Clock,
  Database,
  Globe,
  Key,
  Network,
  Server,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { type ErrorInfo } from "./ErrorHandler";

interface ErrorRecoverySuggestionsProps {
  error: ErrorInfo;
  onApplySuggestion?: (suggestion: RecoverySuggestion) => void;
  showAutoFix?: boolean;
  className?: string;
}

export interface RecoverySuggestion {
  id: string;
  title: string;
  description: string;
  category:
    | "quick-fix"
    | "configuration"
    | "retry"
    | "workaround"
    | "investigation";
  confidence: "high" | "medium" | "low";
  automated: boolean;
  steps: RecoveryStep[];
  estimatedTime?: string;
  successRate?: number;
  prerequisites?: string[];
  risks?: string[];
}

interface RecoveryStep {
  id: string;
  title: string;
  description: string;
  type: "manual" | "automated" | "code" | "config";
  code?: string;
  config?: Record<string, unknown>;
  validation?: {
    test: string;
    expected: string;
  };
}

// Error pattern matching for suggestions
const ERROR_PATTERNS: Record<string, RecoverySuggestion[]> = {
  ECONNREFUSED: [
    {
      id: "check-service-status",
      title: "Check Service Status",
      description: "Verify if the target service is running and accessible",
      category: "investigation",
      confidence: "high",
      automated: false,
      steps: [
        {
          id: "1",
          title: "Check service health",
          description: "Verify the service is responding to health checks",
          type: "manual",
        },
        {
          id: "2",
          title: "Test connectivity",
          description: "Use curl or telnet to test the connection",
          type: "code",
          code: "curl -I https://api.example.com/health",
        },
        {
          id: "3",
          title: "Check DNS resolution",
          description: "Ensure the hostname resolves correctly",
          type: "code",
          code: "nslookup api.example.com",
        },
      ],
      estimatedTime: "5-10 minutes",
      successRate: 85,
    },
    {
      id: "retry-with-backoff",
      title: "Retry with Exponential Backoff",
      description: "Automatically retry the operation with increasing delays",
      category: "retry",
      confidence: "medium",
      automated: true,
      steps: [
        {
          id: "1",
          title: "Configure retry settings",
          description: "Set up exponential backoff parameters",
          type: "config",
          config: {
            maxAttempts: 5,
            initialDelay: 1000,
            maxDelay: 30000,
            backoffMultiplier: 2,
          },
        },
        {
          id: "2",
          title: "Execute retry",
          description: "The system will automatically retry with delays",
          type: "automated",
        },
      ],
      estimatedTime: "1-2 minutes",
      successRate: 70,
    },
    {
      id: "use-fallback-endpoint",
      title: "Use Fallback Endpoint",
      description: "Switch to an alternative endpoint if available",
      category: "workaround",
      confidence: "medium",
      automated: false,
      steps: [
        {
          id: "1",
          title: "Check for fallback URLs",
          description: "Look for alternative endpoints in configuration",
          type: "manual",
        },
        {
          id: "2",
          title: "Update configuration",
          description: "Temporarily use the fallback endpoint",
          type: "config",
          config: {
            primaryUrl: "https://api.example.com",
            fallbackUrl: "https://api-backup.example.com",
            useFallback: true,
          },
        },
      ],
      estimatedTime: "2-5 minutes",
      successRate: 60,
      risks: [
        "Fallback endpoint may have different performance characteristics",
      ],
    },
  ],
  "401": [
    {
      id: "refresh-credentials",
      title: "Refresh Authentication Credentials",
      description: "Update or regenerate authentication tokens",
      category: "quick-fix",
      confidence: "high",
      automated: false,
      steps: [
        {
          id: "1",
          title: "Navigate to credential manager",
          description: "Open the tool credential management interface",
          type: "manual",
        },
        {
          id: "2",
          title: "Re-authenticate",
          description: "Click 'Re-authenticate' or update credentials",
          type: "manual",
        },
        {
          id: "3",
          title: "Test connection",
          description: "Verify the new credentials work",
          type: "manual",
        },
      ],
      estimatedTime: "2-3 minutes",
      successRate: 90,
    },
    {
      id: "check-token-expiry",
      title: "Check Token Expiration",
      description: "Verify if the token has expired and needs renewal",
      category: "investigation",
      confidence: "high",
      automated: true,
      steps: [
        {
          id: "1",
          title: "Decode token",
          description: "Check the token's expiration timestamp",
          type: "code",
          code: "jwt decode <token>",
        },
        {
          id: "2",
          title: "Request new token",
          description: "Use refresh token to get new access token",
          type: "automated",
        },
      ],
      estimatedTime: "1 minute",
      successRate: 95,
      prerequisites: ["Valid refresh token available"],
    },
  ],
  "429": [
    {
      id: "implement-rate-limiting",
      title: "Implement Client-Side Rate Limiting",
      description: "Add rate limiting to prevent hitting API limits",
      category: "configuration",
      confidence: "high",
      automated: true,
      steps: [
        {
          id: "1",
          title: "Configure rate limiter",
          description: "Set up rate limiting parameters",
          type: "config",
          config: {
            requestsPerMinute: 60,
            requestsPerHour: 1000,
            burstSize: 10,
          },
        },
        {
          id: "2",
          title: "Enable queuing",
          description: "Queue requests to stay within limits",
          type: "automated",
        },
      ],
      estimatedTime: "Immediate",
      successRate: 98,
    },
    {
      id: "batch-requests",
      title: "Batch Multiple Requests",
      description: "Combine multiple API calls into batch requests",
      category: "workaround",
      confidence: "medium",
      automated: false,
      steps: [
        {
          id: "1",
          title: "Identify batchable operations",
          description: "Find requests that can be combined",
          type: "manual",
        },
        {
          id: "2",
          title: "Implement batching logic",
          description: "Modify code to batch requests",
          type: "code",
          code: `// Instead of multiple calls
for (const item of items) {
  await api.process(item);
}

// Use batch API
await api.processBatch(items);`,
        },
      ],
      estimatedTime: "10-30 minutes",
      successRate: 80,
      prerequisites: ["API supports batch operations"],
    },
  ],
  ETIMEDOUT: [
    {
      id: "increase-timeout",
      title: "Increase Timeout Settings",
      description: "Extend the timeout duration for slow operations",
      category: "configuration",
      confidence: "medium",
      automated: true,
      steps: [
        {
          id: "1",
          title: "Update timeout configuration",
          description: "Increase timeout values",
          type: "config",
          config: {
            connectionTimeout: 30000,
            requestTimeout: 60000,
            socketTimeout: 120000,
          },
        },
        {
          id: "2",
          title: "Apply changes",
          description: "Restart the operation with new timeouts",
          type: "automated",
        },
      ],
      estimatedTime: "Immediate",
      successRate: 75,
      risks: ["Longer timeouts may impact user experience"],
    },
    {
      id: "optimize-request",
      title: "Optimize Request Size",
      description: "Reduce the amount of data being processed",
      category: "workaround",
      confidence: "medium",
      automated: false,
      steps: [
        {
          id: "1",
          title: "Analyze request payload",
          description: "Check if request is too large",
          type: "manual",
        },
        {
          id: "2",
          title: "Implement pagination",
          description: "Break large requests into smaller chunks",
          type: "code",
          code: `// Process in smaller batches
const batchSize = 100;
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  await processBatch(batch);
}`,
        },
      ],
      estimatedTime: "15-30 minutes",
      successRate: 85,
    },
  ],
};

// Generic suggestions for unknown errors
const GENERIC_SUGGESTIONS: RecoverySuggestion[] = [
  {
    id: "check-logs",
    title: "Review Detailed Logs",
    description: "Examine execution logs for more context",
    category: "investigation",
    confidence: "medium",
    automated: false,
    steps: [
      {
        id: "1",
        title: "Open execution logs",
        description: "Navigate to the logs viewer",
        type: "manual",
      },
      {
        id: "2",
        title: "Filter by error level",
        description: "Focus on error and warning messages",
        type: "manual",
      },
      {
        id: "3",
        title: "Look for patterns",
        description: "Identify any recurring issues or patterns",
        type: "manual",
      },
    ],
    estimatedTime: "5-10 minutes",
  },
  {
    id: "restart-service",
    title: "Restart Related Services",
    description: "Try restarting the service or clearing caches",
    category: "quick-fix",
    confidence: "low",
    automated: false,
    steps: [
      {
        id: "1",
        title: "Identify affected services",
        description: "Determine which services are involved",
        type: "manual",
      },
      {
        id: "2",
        title: "Restart services",
        description: "Restart in the correct order",
        type: "manual",
      },
    ],
    estimatedTime: "5-15 minutes",
    successRate: 50,
    risks: ["May cause temporary service disruption"],
  },
];

export default function ErrorRecoverySuggestions({
  error,
  onApplySuggestion,
  showAutoFix = true,
  className,
}: ErrorRecoverySuggestionsProps) {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<RecoverySuggestion[]>([]);
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(
    new Set(),
  );
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // Get relevant suggestions based on error
  useEffect(() => {
    const relevantSuggestions: RecoverySuggestion[] = [];

    // Check error code patterns
    for (const [pattern, patternSuggestions] of Object.entries(
      ERROR_PATTERNS,
    )) {
      if (
        error.code === pattern ||
        error.message.includes(pattern) ||
        (error.details?.statusCode &&
          error.details.statusCode.toString() === pattern)
      ) {
        relevantSuggestions.push(...patternSuggestions);
      }
    }

    // Add custom suggestions from error
    if (error.suggestions) {
      error.suggestions.forEach((suggestion, idx) => {
        relevantSuggestions.push({
          id: `custom-${idx}`,
          title: "Recommended Action",
          description: suggestion,
          category: "quick-fix",
          confidence: "high",
          automated: false,
          steps: [
            {
              id: "1",
              title: "Follow recommendation",
              description: suggestion,
              type: "manual",
            },
          ],
        });
      });
    }

    // Add generic suggestions if needed
    if (relevantSuggestions.length < 3) {
      relevantSuggestions.push(...GENERIC_SUGGESTIONS);
    }

    // Sort by confidence
    relevantSuggestions.sort((a, b) => {
      const confidenceOrder = { high: 3, medium: 2, low: 1 };
      return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    });

    setSuggestions(relevantSuggestions);
  }, [error]);

  // Apply suggestion
  const applySuggestion = async (suggestion: RecoverySuggestion) => {
    if (!showAutoFix && suggestion.automated) {
      toast({
        title: "Auto-fix Disabled",
        description: "Enable auto-fix to apply automated suggestions",
        variant: "destructive",
      });
      return;
    }

    setApplyingId(suggestion.id);

    try {
      // Simulate applying suggestion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setAppliedSuggestions((prev) => new Set(prev).add(suggestion.id));

      if (onApplySuggestion) {
        onApplySuggestion(suggestion);
      }

      toast({
        title: "Suggestion Applied",
        description: `${suggestion.title} has been applied successfully`,
      });
    } catch (error) {
      toast({
        title: "Failed to Apply",
        description: "Could not apply the suggestion. Please try manually.",
        variant: "destructive",
      });
    } finally {
      setApplyingId(null);
    }
  };

  // Copy code snippet
  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied",
      description: "Code snippet copied to clipboard",
    });
  };

  // Get category icon
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "quick-fix":
        return <Zap className="h-4 w-4" />;
      case "configuration":
        return <Settings className="h-4 w-4" />;
      case "retry":
        return <RefreshCw className="h-4 w-4" />;
      case "workaround":
        return <Wrench className="h-4 w-4" />;
      case "investigation":
        return <HelpCircle className="h-4 w-4" />;
      default:
        return <Lightbulb className="h-4 w-4" />;
    }
  };

  // Get confidence color
  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case "high":
        return "text-green-600 bg-green-100";
      case "medium":
        return "text-yellow-600 bg-yellow-100";
      case "low":
        return "text-orange-600 bg-orange-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Recovery Suggestions
          <Badge variant="outline">{suggestions.length} options</Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {suggestions.length === 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              No specific suggestions available for this error. Try the generic
              troubleshooting steps or contact support.
            </AlertDescription>
          </Alert>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {suggestions.map((suggestion) => (
              <AccordionItem key={suggestion.id} value={suggestion.id}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-start gap-3 text-left">
                    <div className="mt-0.5">
                      {getCategoryIcon(suggestion.category)}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{suggestion.title}</h4>
                        {appliedSuggestions.has(suggestion.id) && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {suggestion.description}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            getConfidenceColor(suggestion.confidence),
                          )}
                        >
                          {suggestion.confidence} confidence
                        </Badge>
                        {suggestion.automated && (
                          <Badge variant="outline" className="text-xs">
                            <Zap className="mr-1 h-3 w-3" />
                            Automated
                          </Badge>
                        )}
                        {suggestion.estimatedTime && (
                          <span className="text-muted-foreground text-xs">
                            <Clock className="mr-1 inline h-3 w-3" />
                            {suggestion.estimatedTime}
                          </span>
                        )}
                        {suggestion.successRate && (
                          <span className="text-muted-foreground text-xs">
                            {suggestion.successRate}% success rate
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent>
                  <div className="space-y-4 pl-7">
                    {/* Prerequisites */}
                    {suggestion.prerequisites &&
                      suggestion.prerequisites.length > 0 && (
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription>
                            <strong>Prerequisites:</strong>
                            <ul className="mt-2 list-inside list-disc">
                              {suggestion.prerequisites.map((prereq, idx) => (
                                <li key={idx} className="text-sm">
                                  {prereq}
                                </li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                    {/* Steps */}
                    <div className="space-y-3">
                      <h5 className="text-sm font-medium">Steps to Apply:</h5>
                      {suggestion.steps.map((step, idx) => (
                        <div key={step.id} className="space-y-2">
                          <div className="flex items-start gap-2">
                            <span className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                              {idx + 1}
                            </span>
                            <div className="flex-1 space-y-1">
                              <h6 className="text-sm font-medium">
                                {step.title}
                              </h6>
                              <p className="text-muted-foreground text-sm">
                                {step.description}
                              </p>

                              {step.code && (
                                <div className="mt-2 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-xs">Code:</Label>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => copyCode(step.code!)}
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">
                                    <code>{step.code}</code>
                                  </pre>
                                </div>
                              )}

                              {step.config && (
                                <div className="mt-2 space-y-1">
                                  <Label className="text-xs">
                                    Configuration:
                                  </Label>
                                  <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">
                                    <code>
                                      {JSON.stringify(step.config, null, 2)}
                                    </code>
                                  </pre>
                                </div>
                              )}

                              {step.validation && (
                                <Alert className="mt-2">
                                  <CheckCircle className="h-4 w-4" />
                                  <AlertDescription>
                                    <strong>Validation:</strong>{" "}
                                    {step.validation.test}
                                    <br />
                                    <strong>Expected:</strong>{" "}
                                    {step.validation.expected}
                                  </AlertDescription>
                                </Alert>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Risks */}
                    {suggestion.risks && suggestion.risks.length > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          <strong>Potential Risks:</strong>
                          <ul className="mt-2 list-inside list-disc">
                            {suggestion.risks.map((risk, idx) => (
                              <li key={idx} className="text-sm">
                                {risk}
                              </li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Apply Button */}
                    {suggestion.automated && showAutoFix && (
                      <Button
                        onClick={() => applySuggestion(suggestion)}
                        disabled={
                          applyingId === suggestion.id ||
                          appliedSuggestions.has(suggestion.id)
                        }
                        className="w-full"
                      >
                        {applyingId === suggestion.id ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : appliedSuggestions.has(suggestion.id) ? (
                          <CheckCircle className="mr-2 h-4 w-4" />
                        ) : (
                          <PlayCircle className="mr-2 h-4 w-4" />
                        )}
                        {appliedSuggestions.has(suggestion.id)
                          ? "Applied"
                          : applyingId === suggestion.id
                            ? "Applying..."
                            : "Apply Automatically"}
                      </Button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        {/* Additional Help */}
        <div className="bg-muted/50 rounded-lg border p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <HelpCircle className="h-4 w-4" />
            Need More Help?
          </h4>
          <div className="space-y-2 text-sm">
            <Button
              variant="link"
              size="sm"
              className="h-auto justify-start p-0"
              onClick={() => window.open("/docs/troubleshooting", "_blank")}
            >
              <ExternalLink className="mr-2 h-3 w-3" />
              View Troubleshooting Guide
            </Button>
            <Button
              variant="link"
              size="sm"
              className="h-auto justify-start p-0"
              onClick={() => window.open("/support", "_blank")}
            >
              <ExternalLink className="mr-2 h-3 w-3" />
              Contact Support Team
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
