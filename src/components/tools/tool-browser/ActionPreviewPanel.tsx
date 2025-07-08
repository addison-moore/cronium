"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Check,
  AlertCircle,
  Code,
  Zap,
  Lock,
  Globe,
  Clock,
  ArrowRight,
  Play,
  Star,
  Copy,
  ExternalLink,
} from "lucide-react";
import {
  type ToolPlugin,
  type ToolAction,
  type ActionParameter,
} from "@/components/tools/types/tool-plugin";
import { cn } from "@/lib/utils";

interface ActionPreviewPanelProps {
  tool: ToolPlugin;
  action: ToolAction;
  onUseAction?: () => void;
  onTestAction?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  className?: string;
}

export function ActionPreviewPanel({
  tool,
  action,
  onUseAction,
  onTestAction,
  isFavorite,
  onToggleFavorite,
  className,
}: ActionPreviewPanelProps) {
  const Icon = tool.icon;

  // Determine authentication status
  const requiresAuth = action.requiresCredentials ?? true;
  const hasCredentials = tool.credentials?.configured ?? false;

  // Get parameter count
  const requiredParams = action.parameters.filter((p: ActionParameter) => p.required).length;
  const totalParams = action.parameters.length;

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="bg-muted rounded-lg p-2">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-xl">{action.name}</CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">{tool.name}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onToggleFavorite}>
              <Star
                className={cn(
                  "h-4 w-4",
                  isFavorite && "fill-yellow-400 text-yellow-400",
                )}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Description */}
        <div>
          <p className="text-sm leading-relaxed">{action.description}</p>
        </div>

        {/* Status Indicators */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <Zap className="h-3 w-3" />
            {action.category}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Code className="h-3 w-3" />
            {action.actionType}
          </Badge>
          {action.developmentMode && (
            <Badge variant="secondary" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {action.developmentMode}
            </Badge>
          )}
          {requiresAuth && (
            <Badge
              variant={hasCredentials ? "success" : "destructive"}
              className="gap-1"
            >
              <Lock className="h-3 w-3" />
              {hasCredentials ? "Authenticated" : "Auth Required"}
            </Badge>
          )}
        </div>

        <Separator />

        {/* Parameters Overview */}
        <div>
          <h4 className="mb-3 text-sm font-medium">Parameters</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Required fields</span>
              <span className="font-medium">{requiredParams}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Optional fields</span>
              <span className="font-medium">
                {totalParams - requiredParams}
              </span>
            </div>
          </div>

          {/* Parameter List */}
          <div className="mt-4 space-y-2">
            {action.parameters.slice(0, 5).map((param: ActionParameter) => (
              <div key={param.name} className="flex items-center gap-2 text-sm">
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    param.required ? "bg-primary" : "bg-muted-foreground",
                  )}
                />
                <span className="font-mono text-xs">{param.name}</span>
                <span className="text-muted-foreground">
                  {param.type}
                  {param.required && "*"}
                </span>
              </div>
            ))}
            {action.parameters.length > 5 && (
              <p className="text-muted-foreground text-xs">
                +{action.parameters.length - 5} more parameters
              </p>
            )}
          </div>
        </div>

        <Separator />

        {/* Features & Capabilities */}
        <div>
          <h4 className="mb-3 text-sm font-medium">Features</h4>
          <div className="space-y-2">
            {action.features?.testMode !== false && (
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500" />
                <span>Test mode available</span>
              </div>
            )}
            {action.features?.realTime && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-blue-500" />
                <span>Real-time execution</span>
              </div>
            )}
            {action.features?.batchSupport && (
              <div className="flex items-center gap-2 text-sm">
                <Copy className="h-4 w-4 text-purple-500" />
                <span>Batch operations supported</span>
              </div>
            )}
            {action.features?.webhookSupport && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-orange-500" />
                <span>Webhook triggers available</span>
              </div>
            )}
          </div>
        </div>

        {/* Example Usage */}
        {action.examples && action.examples.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-3 text-sm font-medium">Example Usage</h4>
              <div className="bg-muted rounded-lg p-3">
                <pre className="text-xs">
                  <code>{JSON.stringify(action.examples[0], null, 2)}</code>
                </pre>
              </div>
            </div>
          </>
        )}

        {/* Authentication Warning */}
        {requiresAuth && !hasCredentials && (
          <Alert className="border-orange-500/50 bg-orange-50 dark:bg-orange-950/20">
            <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            <AlertDescription className="text-orange-800 dark:text-orange-200">
              This action requires authentication. Please configure {tool.name}{" "}
              credentials before using this action.
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={onUseAction}
            disabled={requiresAuth && !hasCredentials}
            className="flex-1"
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            Use This Action
          </Button>
          {action.features?.testMode !== false && (
            <Button
              variant="outline"
              onClick={onTestAction}
              disabled={requiresAuth && !hasCredentials}
            >
              <Play className="mr-2 h-4 w-4" />
              Test
            </Button>
          )}
        </div>

        {/* Help Link */}
        {action.helpUrl && (
          <div className="flex justify-center">
            <Button
              variant="link"
              size="sm"
              className="text-xs"
              onClick={() => window.open(action.helpUrl, "_blank")}
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              View Documentation
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
