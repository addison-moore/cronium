"use client";

import React, { useState, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Info,
  Search,
  Settings,
  TestTube,
  Zap,
  FileText,
  History,
  Shield,
  RefreshCw,
} from "lucide-react";
import { type ToolAction } from "@/components/tools/types/tool-plugin";

// Lazy load all heavy tool components
import {
  LazyToolBrowser,
  LazyActionParameterForm,
  LazyTestDataGenerator,
  LazyExecutionLogsViewer,
  LazyCredentialHealthIndicator,
  preloadToolComponents,
} from "@/components/tools/lazy";

interface OptimizedToolActionSectionProps {
  config: {
    toolId?: string;
    actionId?: string;
    parameters?: Record<string, unknown>;
  };
  onChange: (config: any) => void;
  showTestButton?: boolean;
  onTest?: () => void;
  errors?: Record<string, string>;
}

export default function OptimizedToolActionSection({
  config,
  onChange,
  showTestButton = true,
  onTest,
  errors,
}: OptimizedToolActionSectionProps) {
  const [activeTab, setActiveTab] = useState("browse");
  const [selectedAction, setSelectedAction] = useState<ToolAction | null>(null);
  const [testResults, setTestResults] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Preload components when tab is about to change
  const handleTabChange = useCallback((value: string) => {
    // Preload the target tab's components
    if (value === "browse" || value === "configure") {
      preloadToolComponents();
    }
    setActiveTab(value);
  }, []);

  // Memoize tab content to prevent unnecessary re-renders
  const tabContent = useMemo(
    () => ({
      browse: (
        <LazyToolBrowser
          onSelectAction={(action: ToolAction) => {
            setSelectedAction(action);
            onChange({
              ...config,
              toolId: action.toolId,
              actionId: action.id,
            });
            setActiveTab("configure");
          }}
          selectedActionId={config.actionId}
        />
      ),
      configure: selectedAction ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Configure {selectedAction.name}</span>
                <Badge variant="outline">{selectedAction.category}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LazyActionParameterForm
                action={selectedAction}
                values={config.parameters || {}}
                onChange={(params) =>
                  onChange({ ...config, parameters: params })
                }
                errors={errors}
              />
            </CardContent>
          </Card>

          <LazyTestDataGenerator
            action={selectedAction}
            onApply={(data) => onChange({ ...config, parameters: data })}
            currentValue={config.parameters}
          />
        </div>
      ) : (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Select an action from the Browse tab to configure it.
          </AlertDescription>
        </Alert>
      ),
      test: (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Test Execution</CardTitle>
            </CardHeader>
            <CardContent>
              {testResults ? (
                <pre className="bg-muted max-h-96 overflow-auto rounded-lg p-4">
                  <code>{JSON.stringify(testResults, null, 2)}</code>
                </pre>
              ) : (
                <div className="py-8 text-center">
                  <TestTube className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                  <p className="text-muted-foreground">
                    No test results yet. Configure and test your action.
                  </p>
                  {showTestButton && selectedAction && (
                    <Button
                      onClick={handleTestExecution}
                      disabled={isExecuting}
                      className="mt-4"
                    >
                      {isExecuting ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="mr-2 h-4 w-4" />
                      )}
                      Test Action
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <LazyExecutionLogsViewer
            toolId={config.toolId ? parseInt(config.toolId) : undefined}
            maxLogs={50}
          />
        </div>
      ),
      monitor: (
        <div className="space-y-6">
          <LazyCredentialHealthIndicator
            toolId={config.toolId ? parseInt(config.toolId) : undefined}
            autoCheck={true}
            checkInterval={5}
          />

          <LazyExecutionLogsViewer
            toolId={config.toolId ? parseInt(config.toolId) : undefined}
            maxLogs={100}
          />
        </div>
      ),
    }),
    [
      config,
      selectedAction,
      onChange,
      errors,
      testResults,
      isExecuting,
      showTestButton,
    ],
  );

  const handleTestExecution = useCallback(async () => {
    if (!onTest) return;

    setIsExecuting(true);
    try {
      await onTest();
      // In a real implementation, this would receive test results
      setTestResults({
        success: true,
        output: "Test execution completed",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      setTestResults({
        success: false,
        error: error instanceof Error ? error.message : "Test failed",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsExecuting(false);
    }
  }, [onTest]);

  // Loading skeleton
  const TabSkeleton = () => (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Tool Action Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="browse" className="gap-2">
              <Search className="h-4 w-4" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="configure" className="gap-2">
              <Settings className="h-4 w-4" />
              Configure
            </TabsTrigger>
            <TabsTrigger value="test" className="gap-2">
              <TestTube className="h-4 w-4" />
              Test
            </TabsTrigger>
            <TabsTrigger value="monitor" className="gap-2">
              <Shield className="h-4 w-4" />
              Monitor
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <React.Suspense fallback={<TabSkeleton />}>
              <TabsContent value={activeTab} className="mt-0">
                {tabContent[activeTab as keyof typeof tabContent]}
              </TabsContent>
            </React.Suspense>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
