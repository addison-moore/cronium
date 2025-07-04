"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  TestTube, 
  Send, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle,
  Zap,
  Mail,
  MessageSquare,
  Webhook,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/components/providers/TrpcProvider";
import { cn } from "@/lib/utils";

interface IntegrationTestPanelProps {
  toolId?: number;
  onClose?: () => void;
}

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
  duration?: number;
  timestamp: Date;
}

export function IntegrationTestPanel({ toolId, onClose }: IntegrationTestPanelProps) {
  const [selectedTool, setSelectedTool] = useState<any>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [isRunningTest, setIsRunningTest] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState("Hello from Cronium! This is a test message.");
  const [testRecipient, setTestRecipient] = useState("test@example.com");
  const [testSubject, setTestSubject] = useState("Cronium Test Message");
  const { toast } = useToast();

  // tRPC queries and mutations
  const { data: toolsData } = trpc.tools.getAll.useQuery({ limit: 100 });
  const { data: toolData } = trpc.tools.getById.useQuery(
    { id: toolId! },
    { enabled: !!toolId }
  );

  const testConnectionMutation = trpc.integrations.testMessage.useMutation();

  const slackSendMutation = trpc.integrations.slack.send.useMutation();
  const discordSendMutation = trpc.integrations.discord.send.useMutation();
  const emailSendMutation = trpc.integrations.email.send.useMutation();
  const webhookSendMutation = trpc.integrations.webhook.send.useMutation();

  const tools = toolsData?.tools || [];
  const currentTool = toolId ? toolData : selectedTool;

  const getToolIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'email':
        return Mail;
      case 'slack':
        return MessageSquare;
      case 'discord':
        return MessageSquare;
      case 'webhook':
        return Webhook;
      default:
        return TestTube;
    }
  };

  const runTest = async (testType: 'connection' | 'send', tool: any) => {
    if (!tool) return;

    const testKey = `${tool.id}-${testType}`;
    setIsRunningTest(testKey);

    const startTime = performance.now();

    try {
      let result: any;

      if (testType === 'connection') {
        result = await testConnectionMutation.mutateAsync({
          toolId: tool.id,
          testType: 'connection',
        });
      } else {
        // Send test based on tool type
        switch (tool.type.toLowerCase()) {
          case 'slack':
            result = await slackSendMutation.mutateAsync({
              toolId: tool.id,
              message: testMessage,
              username: 'Cronium Test Bot',
            });
            break;
          case 'discord':
            result = await discordSendMutation.mutateAsync({
              toolId: tool.id,
              message: testMessage,
              username: 'Cronium Test Bot',
            });
            break;
          case 'email':
            result = await emailSendMutation.mutateAsync({
              toolId: tool.id,
              recipients: testRecipient,
              subject: testSubject,
              message: testMessage,
            });
            break;
          case 'webhook':
            result = await webhookSendMutation.mutateAsync({
              toolId: tool.id,
              payload: { message: testMessage, test: true },
              method: 'POST',
            });
            break;
          default:
            throw new Error('Unsupported tool type for testing');
        }
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

      setTestResults(prev => ({ ...prev, [testKey]: testResult }));

      toast({
        title: result.success ? "Test Successful" : "Test Failed",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });

    } catch (error: any) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      const testResult: TestResult = {
        success: false,
        message: error.message || "Test failed with unknown error",
        duration,
        timestamp: new Date(),
      };

      setTestResults(prev => ({ ...prev, [testKey]: testResult }));

      toast({
        title: "Test Failed",
        description: error.message || "Test failed with unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRunningTest(null);
    }
  };

  const getTestResultIcon = (result: TestResult) => {
    if (result.success) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    } else {
      return <XCircle className="w-4 h-4 text-red-500" />;
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

    await runTest('connection', currentTool);
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
    await runTest('send', currentTool);
  };

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TestTube className="w-5 h-5" />
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
              value={selectedTool?.id?.toString() || ""}
              onValueChange={(value) => {
                const tool = tools.find(t => t.id === parseInt(value));
                setSelectedTool(tool);
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
                        <IconComponent className="w-4 h-4" />
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
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                {React.createElement(getToolIcon(currentTool.type), { 
                  className: "w-6 h-6 text-primary" 
                })}
                <h3 className="font-semibold text-lg">{currentTool.name}</h3>
                <Badge variant={currentTool.isActive ? "default" : "secondary"}>
                  {currentTool.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="outline">{currentTool.type}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Tool ID: {currentTool.id} • Created: {new Date(currentTool.createdAt).toLocaleDateString()}
              </p>
            </div>

            <Tabs defaultValue="quick-test" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="quick-test">Quick Test</TabsTrigger>
                <TabsTrigger value="custom-test">Custom Test</TabsTrigger>
                <TabsTrigger value="results">Results</TabsTrigger>
              </TabsList>

              <TabsContent value="quick-test" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button
                    onClick={() => runTest('connection', currentTool)}
                    disabled={!currentTool.isActive || isRunningTest === `${currentTool.id}-connection`}
                    className="h-20 flex flex-col items-center gap-2"
                  >
                    {isRunningTest === `${currentTool.id}-connection` ? (
                      <Clock className="w-6 h-6 animate-spin" />
                    ) : (
                      <Zap className="w-6 h-6" />
                    )}
                    <span>Test Connection</span>
                  </Button>

                  <Button
                    onClick={() => runTest('send', currentTool)}
                    disabled={!currentTool.isActive || isRunningTest === `${currentTool.id}-send`}
                    className="h-20 flex flex-col items-center gap-2"
                    variant="outline"
                  >
                    {isRunningTest === `${currentTool.id}-send` ? (
                      <Clock className="w-6 h-6 animate-spin" />
                    ) : (
                      <Send className="w-6 h-6" />
                    )}
                    <span>Send Test Message</span>
                  </Button>

                  <Button
                    onClick={() => runAllTests()}
                    disabled={!currentTool.isActive || isRunningTest !== null}
                    className="h-20 flex flex-col items-center gap-2"
                    variant="secondary"
                  >
                    {isRunningTest ? (
                      <Clock className="w-6 h-6 animate-spin" />
                    ) : (
                      <TestTube className="w-6 h-6" />
                    )}
                    <span>Run All Tests</span>
                  </Button>
                </div>

                {/* Quick Test Results */}
                <div className="space-y-2">
                  {['connection', 'send'].map((testType) => {
                    const testKey = `${currentTool.id}-${testType}`;
                    const result = testResults[testKey];
                    
                    if (!result) return null;

                    return (
                      <div
                        key={testType}
                        className={cn(
                          "p-3 rounded-lg border flex items-center justify-between",
                          result.success 
                            ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
                            : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {getTestResultIcon(result)}
                          <div>
                            <p className="font-medium capitalize">{testType} Test</p>
                            <p className="text-sm text-muted-foreground">{result.message}</p>
                          </div>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          <p>{formatDuration(result.duration || 0)}</p>
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

                  {currentTool.type.toLowerCase() === 'email' && (
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
                    onClick={() => runTest('send', currentTool)}
                    disabled={!currentTool.isActive || isRunningTest !== null}
                    className="w-full"
                  >
                    {isRunningTest ? (
                      <>
                        <Clock className="w-4 h-4 mr-2 animate-spin" />
                        Sending Test...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Custom Test
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="results" className="space-y-4">
                <div className="space-y-3">
                  {Object.entries(testResults).length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                      <p>No test results yet.</p>
                      <p className="text-sm">Run some tests to see results here.</p>
                    </div>
                  ) : (
                    Object.entries(testResults).map(([testKey, result]) => {
                      const [toolId, testType] = testKey.split('-');
                      
                      return (
                        <div
                          key={testKey}
                          className="p-4 border rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getTestResultIcon(result)}
                              <span className="font-medium capitalize">{testType} Test</span>
                              <Badge variant="outline" className="text-xs">
                                {formatDuration(result.duration || 0)}
                              </Badge>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {result.timestamp.toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm">{result.message}</p>
                          {result.details && (
                            <details className="text-xs text-muted-foreground">
                              <summary className="cursor-pointer">View Details</summary>
                              <pre className="mt-2 p-2 bg-muted rounded overflow-auto">
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
          <div className="text-center py-8 text-muted-foreground">
            <TestTube className="w-12 h-12 mx-auto mb-4" />
            <p>Select a tool to start testing integrations.</p>
            <p className="text-sm">Test connections, send messages, and validate configurations.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}