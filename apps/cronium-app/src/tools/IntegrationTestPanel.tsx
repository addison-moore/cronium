"use client";

import React, { useState } from "react";
import { Button } from "@cronium/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Textarea } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import {
  TestTube,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Zap,
} from "lucide-react";
import { useToast } from "@cronium/ui";
import { trpc } from "@/components/providers/TrpcProvider";
import { cn } from "@/lib/utils";
// ToolType import removed - using strings directly
import { ToolPluginRegistry } from "@/tools/types/tool-plugin";
import type { RouterOutputs } from "@/server/api/root";

// Type for tool data as returned by the API
type ToolWithDecryptedCredentials =
  RouterOutputs["tools"]["getAll"]["tools"][0];

interface IntegrationTestPanelProps {
  toolId?: number;
  onClose?: () => void;
}

interface TestResult {
  success: boolean;
  message: string;
  details?: unknown;
  duration?: number;
  timestamp: Date;
}

interface TestResponse {
  success: boolean;
  message: string;
  details?: unknown;
}

export function IntegrationTestPanel({
  toolId,
  onClose,
}: IntegrationTestPanelProps) {
  const [selectedTool, setSelectedTool] =
    useState<ToolWithDecryptedCredentials | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );
  const [isRunningTest, setIsRunningTest] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState(
    "Hello from Cronium! This is a test message.",
  );
  const [testRecipient, setTestRecipient] = useState("test@example.com");
  const [testSubject, setTestSubject] = useState("Cronium Test Message");
  const { toast } = useToast();

  // tRPC queries and mutations
  const { data: toolsData } = trpc.tools.getAll.useQuery({ limit: 100 });
  const { data: toolData } = trpc.tools.getById.useQuery(
    { id: toolId! },
    { enabled: !!toolId },
  );

  // Note: This component appears to be deprecated - consider removing
  // Using a default plugin mutation for now
  const testConnectionMutation = trpc.tools.test.useMutation();

  // Dynamic access to plugin mutations
  const pluginRoutes = trpc.tools.plugins as Record<
    string,
    {
      testConnection?: {
        useMutation: () => ReturnType<typeof trpc.tools.test.useMutation>;
      };
    }
  >;

  // Helper to get test mutation for a tool type
  const getTestMutation = (toolType: string) => {
    const pluginKey = toolType.toLowerCase();
    return pluginRoutes?.[pluginKey]?.testConnection?.useMutation();
  };

  const tools = toolsData?.tools ?? [];
  const currentTool = toolId ? toolData : selectedTool;

  const getToolIcon = (type: string) => {
    const plugin = ToolPluginRegistry.get(type.toLowerCase());
    return plugin?.icon ?? TestTube;
  };

  const runTest = async (
    testType: "connection" | "send",
    tool: ToolWithDecryptedCredentials,
  ) => {
    if (!tool) return;

    const testKey = `${tool.id}-${testType}`;
    setIsRunningTest(testKey);

    const startTime = performance.now();

    try {
      let result: TestResponse;

      if (testType === "connection") {
        // Use plugin-specific test connection if available
        const testMutation = getTestMutation(tool.type);
        if (testMutation) {
          result = (await testMutation.mutateAsync({
            id: tool.id,
          })) as TestResponse;
        } else {
          // Fallback to legacy test connection
          result = (await testConnectionMutation.mutateAsync({
            id: tool.id,
            testData: {},
          })) as TestResponse;
        }
      } else {
        // Use the legacy test message endpoint for send tests
        result = (await testConnectionMutation.mutateAsync({
          id: tool.id,
          testData: {
            type: "send_test_message",
            message: testMessage,
            recipient: testRecipient,
          },
        })) as TestResponse;
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      const testResult: TestResult = {
        success: result.success,
        message: result.message,
        details: result.details,
        duration,
        timestamp: new Date(),
      };

      setTestResults((prev) => ({ ...prev, [testKey]: testResult }));

      toast({
        title: result.success ? "Test Successful" : "Test Failed",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      const testResult: TestResult = {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Test failed with unknown error",
        duration,
        timestamp: new Date(),
      };

      setTestResults((prev) => ({ ...prev, [testKey]: testResult }));

      toast({
        title: "Test Failed",
        description:
          error instanceof Error
            ? error.message
            : "Test failed with unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRunningTest(null);
    }
  };

  const getTestResultIcon = (result: TestResult) => {
    if (result.success) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    } else {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  };

  const runAllTests = async () => {
    if (!currentTool) return;

    await runTest("connection", currentTool);
    await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay between tests
    await runTest("send", currentTool);
  };

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Integration Testing Panel
          </CardTitle>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!toolId && (
          <div className="space-y-2">
            <Label>Select Tool to Test</Label>
            <Select
              value={selectedTool?.id?.toString() ?? ""}
              onValueChange={(value) => {
                const tool = tools.find((t) => t.id === parseInt(value));
                setSelectedTool(tool ?? null);
                setTestResults({}); // Clear previous results
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a tool..." />
              </SelectTrigger>
              <SelectContent>
                {tools.map((tool) => {
                  const IconComponent = getToolIcon(tool.type);
                  return (
                    <SelectItem key={tool.id} value={tool.id.toString()}>
                      <div className="flex items-center gap-2">
                        <IconComponent className="h-4 w-4" />
                        <span>{tool.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {tool.type}
                        </Badge>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}

        {currentTool && (
          <div className="space-y-6">
            {/* Tool Information */}
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="mb-2 flex items-center gap-3">
                {React.createElement(getToolIcon(currentTool.type), {
                  className: "w-6 h-6 text-primary",
                })}
                <h3 className="text-lg font-semibold">{currentTool.name}</h3>
                <Badge variant={currentTool.isActive ? "default" : "secondary"}>
                  {currentTool.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="outline">{currentTool.type}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                Tool ID: {currentTool.id} • Created:{" "}
                {new Date(currentTool.createdAt).toLocaleDateString()}
              </p>
            </div>

            <Tabs defaultValue="quick-test" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="quick-test">Quick Test</TabsTrigger>
                <TabsTrigger value="custom-test">Custom Test</TabsTrigger>
                <TabsTrigger value="results">Results</TabsTrigger>
              </TabsList>

              <TabsContent value="quick-test" className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Button
                    onClick={() => runTest("connection", currentTool)}
                    disabled={
                      !currentTool.isActive ||
                      isRunningTest === `${currentTool.id}-connection`
                    }
                    className="flex h-20 flex-col items-center gap-2"
                  >
                    {isRunningTest === `${currentTool.id}-connection` ? (
                      <Clock className="h-6 w-6 animate-spin" />
                    ) : (
                      <Zap className="h-6 w-6" />
                    )}
                    <span>Test Connection</span>
                  </Button>

                  <Button
                    onClick={() => runTest("send", currentTool)}
                    disabled={
                      !currentTool.isActive ||
                      isRunningTest === `${currentTool.id}-send`
                    }
                    className="flex h-20 flex-col items-center gap-2"
                    variant="outline"
                  >
                    {isRunningTest === `${currentTool.id}-send` ? (
                      <Clock className="h-6 w-6 animate-spin" />
                    ) : (
                      <Send className="h-6 w-6" />
                    )}
                    <span>Send Test Message</span>
                  </Button>

                  <Button
                    onClick={() => runAllTests()}
                    disabled={!currentTool.isActive || isRunningTest !== null}
                    className="flex h-20 flex-col items-center gap-2"
                    variant="secondary"
                  >
                    {isRunningTest ? (
                      <Clock className="h-6 w-6 animate-spin" />
                    ) : (
                      <TestTube className="h-6 w-6" />
                    )}
                    <span>Run All Tests</span>
                  </Button>
                </div>

                {/* Quick Test Results */}
                <div className="space-y-2">
                  {["connection", "send"].map((testType) => {
                    const testKey = `${currentTool.id}-${testType}`;
                    const result = testResults[testKey];

                    if (!result) return null;

                    return (
                      <div
                        key={testType}
                        className={cn(
                          "flex items-center justify-between rounded-lg border p-3",
                          result.success
                            ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                            : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {getTestResultIcon(result)}
                          <div>
                            <p className="font-medium capitalize">
                              {testType} Test
                            </p>
                            <p className="text-muted-foreground text-sm">
                              {result.message}
                            </p>
                          </div>
                        </div>
                        <div className="text-muted-foreground text-right text-sm">
                          <p>{formatDuration(result.duration ?? 0)}</p>
                          <p>{result.timestamp.toLocaleTimeString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="custom-test" className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="test-message">Test Message</Label>
                    <Textarea
                      id="test-message"
                      placeholder="Enter your test message..."
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      rows={3}
                    />
                  </div>

                  {currentTool.type === "EMAIL" && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="test-recipient">Test Recipient</Label>
                        <Input
                          id="test-recipient"
                          type="email"
                          placeholder="test@example.com"
                          value={testRecipient}
                          onChange={(e) => setTestRecipient(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="test-subject">Subject</Label>
                        <Input
                          id="test-subject"
                          placeholder="Test Email Subject"
                          value={testSubject}
                          onChange={(e) => setTestSubject(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  <Button
                    onClick={() => runTest("send", currentTool)}
                    disabled={!currentTool.isActive || isRunningTest !== null}
                    className="w-full"
                  >
                    {isRunningTest ? (
                      <>
                        <Clock className="mr-2 h-4 w-4 animate-spin" />
                        Sending Test...
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Send Custom Test
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="results" className="space-y-4">
                <div className="space-y-3">
                  {Object.entries(testResults).length === 0 ? (
                    <div className="text-muted-foreground py-8 text-center">
                      <AlertCircle className="mx-auto mb-2 h-8 w-8" />
                      <p>No test results yet.</p>
                      <p className="text-sm">
                        Run some tests to see results here.
                      </p>
                    </div>
                  ) : (
                    Object.entries(testResults).map(([testKey, result]) => {
                      const [, testType] = testKey.split("-");

                      return (
                        <div
                          key={testKey}
                          className="border-border space-y-2 rounded-lg border p-4"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getTestResultIcon(result)}
                              <span className="font-medium capitalize">
                                {testType} Test
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {formatDuration(result.duration ?? 0)}
                              </Badge>
                            </div>
                            <span className="text-muted-foreground text-sm">
                              {result.timestamp.toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm">{result.message}</p>
                          {result.details !== undefined &&
                            result.details !== null && (
                              <details className="text-muted-foreground text-xs">
                                <summary className="cursor-pointer">
                                  View Details
                                </summary>
                                <pre className="bg-muted mt-2 overflow-auto rounded p-2">
                                  {JSON.stringify(result.details, null, 2)}
                                </pre>
                              </details>
                            )}
                        </div>
                      );
                    })
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {!currentTool && !toolId && (
          <div className="text-muted-foreground py-8 text-center">
            <TestTube className="mx-auto mb-4 h-12 w-12" />
            <p>Select a tool to start testing integrations.</p>
            <p className="text-sm">
              Test connections, send messages, and validate configurations.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
