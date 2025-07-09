"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Eye } from "lucide-react";
import { type ToolAction } from "@/components/tools/types/tool-plugin";
import {
  processToolActionTemplate,
  extractTemplateVariables,
} from "@/lib/tool-action-template-processor";
import { type TemplateContext } from "@/lib/template-processor";
import { createTemplateContext } from "@/lib/template-processor";
import { useToast } from "@/components/ui/use-toast";

interface TemplatePreviewProps {
  action: ToolAction;
  parameters: Record<string, unknown>;
  toolType: string;
}

// Sample data for preview
const SAMPLE_CONTEXT = createTemplateContext(
  {
    id: 123,
    name: "Daily Backup Task",
    status: "success",
    duration: 45230,
    executionTime: new Date().toISOString(),
    server: "production-server-01",
    output: "Backup completed successfully. 150 files processed.",
  },
  {
    adminEmail: "admin@example.com",
    appName: "MyApp",
    environment: "production",
    successCount: 45,
    failureCount: 2,
    totalEvents: 47,
    successfulEvents: 45,
    failedEvents: 2,
    avgDuration: "2.3 minutes",
    notableEvents: "- Backup task completed\n- API health check passed",
    reportEmail: "reports@example.com",
  },
);

const SAMPLE_CONTEXT_FAILURE = createTemplateContext(
  {
    id: 124,
    name: "Database Migration",
    status: "failure",
    duration: 12500,
    executionTime: new Date().toISOString(),
    server: "staging-server-02",
    error: "Connection timeout: Unable to connect to database after 10 seconds",
  },
  {
    adminEmail: "admin@example.com",
    appName: "MyApp",
    environment: "staging",
  },
);

export function TemplatePreview({
  action,
  parameters,
  toolType,
}: TemplatePreviewProps) {
  const { toast } = useToast();
  const [selectedContext, setSelectedContext] = useState<"success" | "failure">(
    "success",
  );
  const [customContext, setCustomContext] = useState("");
  const [useCustomContext, setUseCustomContext] = useState(false);

  // Get the current context
  const getCurrentContext = () => {
    if (useCustomContext && customContext) {
      try {
        return JSON.parse(customContext) as Record<string, unknown>;
      } catch (error) {
        console.error("Invalid custom context:", error);
        return selectedContext === "success"
          ? SAMPLE_CONTEXT
          : SAMPLE_CONTEXT_FAILURE;
      }
    }
    return selectedContext === "success"
      ? SAMPLE_CONTEXT
      : SAMPLE_CONTEXT_FAILURE;
  };

  // Process the template with sample data
  const processedTemplate = processToolActionTemplate(
    { parameters },
    getCurrentContext() as TemplateContext,
  );

  // Extract variables used in the template
  const usedVariables = extractTemplateVariables(parameters);

  // Copy processed value to clipboard
  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: "Copied to clipboard",
        description: "The processed value has been copied to your clipboard.",
      });
    } catch {
      toast({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  // Render preview of a parameter
  const renderParameterPreview = (
    key: string,
    value: unknown,
    processedValue: unknown,
  ) => {
    const originalStr =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const processedStr =
      typeof processedValue === "string"
        ? processedValue
        : JSON.stringify(processedValue, null, 2);

    const hasChanged = originalStr !== processedStr;

    return (
      <div key={key} className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{key}</Label>
          {hasChanged && (
            <Badge variant="secondary" className="text-xs">
              Processed
            </Badge>
          )}
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {/* Original */}
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Template</p>
            <div className="relative">
              <Textarea
                value={originalStr}
                readOnly
                className="min-h-[80px] font-mono text-xs"
              />
            </div>
          </div>

          {/* Processed */}
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Preview</p>
            <div className="relative">
              <Textarea
                value={processedStr}
                readOnly
                className={`min-h-[80px] font-mono text-xs ${
                  hasChanged ? "border-green-500" : ""
                }`}
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => copyToClipboard(processedStr)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Context Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview Context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={selectedContext === "success" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setSelectedContext("success");
                setUseCustomContext(false);
              }}
            >
              Success Context
            </Button>
            <Button
              variant={selectedContext === "failure" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setSelectedContext("failure");
                setUseCustomContext(false);
              }}
            >
              Failure Context
            </Button>
            <Button
              variant={useCustomContext ? "default" : "outline"}
              size="sm"
              onClick={() => setUseCustomContext(!useCustomContext)}
            >
              Custom Context
            </Button>
          </div>

          {useCustomContext && (
            <div className="space-y-2">
              <Label htmlFor="customContext">Custom Context (JSON)</Label>
              <Textarea
                id="customContext"
                value={customContext}
                onChange={(e) => setCustomContext(e.target.value)}
                placeholder={JSON.stringify(SAMPLE_CONTEXT, null, 2)}
                className="font-mono text-xs"
                rows={10}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Variable Usage */}
      {usedVariables.length > 0 && (
        <Alert>
          <Eye className="h-4 w-4" />
          <AlertDescription>
            <strong>Template Variables Used:</strong>{" "}
            {usedVariables.map((v) => `{{cronium.${v}}}`).join(", ")}
          </AlertDescription>
        </Alert>
      )}

      {/* Parameter Previews */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {action.name} - {toolType}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(parameters).length === 0 ? (
            <p className="text-muted-foreground text-center">
              No parameters configured yet
            </p>
          ) : (
            Object.entries(parameters).map(([key, value]) =>
              renderParameterPreview(
                key,
                value,
                processedTemplate.parameters[key],
              ),
            )
          )}
        </CardContent>
      </Card>

      {/* Full Processed Output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Full Processed Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Textarea
              value={JSON.stringify(processedTemplate.parameters, null, 2)}
              readOnly
              className="min-h-[200px] font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() =>
                copyToClipboard(
                  JSON.stringify(processedTemplate.parameters, null, 2),
                )
              }
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
