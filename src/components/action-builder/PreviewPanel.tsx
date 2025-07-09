"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play,
  Pause,
  RotateCcw,
  AlertCircle,
  CheckCircle,
  Clock,
  ArrowRight,
} from "lucide-react";
import { ActionNode, ActionConnection, NodeType } from "./types";
import { useActionBuilder } from "./useActionBuilder";

interface PreviewPanelProps {
  onExecute?: () => void;
  onStop?: () => void;
  onReset?: () => void;
}

interface ExecutionStep {
  nodeId: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  startTime?: Date;
  endTime?: Date;
  input?: any;
  output?: any;
  error?: string;
}

export function PreviewPanel({
  onExecute,
  onStop,
  onReset,
}: PreviewPanelProps) {
  const { nodes, connections, getExecutionOrder } = useActionBuilder();
  const [isExecuting, setIsExecuting] = React.useState(false);
  const [executionSteps, setExecutionSteps] = React.useState<ExecutionStep[]>(
    [],
  );
  const [currentStep, setCurrentStep] = React.useState<number>(-1);

  const executionOrder = React.useMemo(() => {
    return getExecutionOrder();
  }, [getExecutionOrder]);

  const handleExecute = async () => {
    setIsExecuting(true);
    setCurrentStep(0);
    setExecutionSteps(
      executionOrder.map((nodeId) => ({
        nodeId,
        status: "pending",
      })),
    );

    // Simulate execution
    for (let i = 0; i < executionOrder.length; i++) {
      setCurrentStep(i);
      setExecutionSteps((prev) => {
        const updated = [...prev];
        updated[i] = {
          ...updated[i],
          status: "running",
          startTime: new Date(),
        } as ExecutionStep;
        return updated;
      });

      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate success/error randomly
      const isSuccess = Math.random() > 0.2;
      setExecutionSteps((prev) => {
        const updated = [...prev];
        updated[i] = {
          ...updated[i],
          status: isSuccess ? "success" : "error",
          endTime: new Date(),
          output: isSuccess ? { result: "Success data" } : undefined,
          error: isSuccess ? undefined : "Simulated error",
        } as ExecutionStep;
        return updated;
      });

      if (!isSuccess) {
        break; // Stop execution on error
      }
    }

    setIsExecuting(false);
    onExecute?.();
  };

  const handleStop = () => {
    setIsExecuting(false);
    onStop?.();
  };

  const handleReset = () => {
    setExecutionSteps([]);
    setCurrentStep(-1);
    onReset?.();
  };

  const getStatusIcon = (status: ExecutionStep["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="text-muted-foreground h-4 w-4" />;
      case "running":
        return <Clock className="h-4 w-4 animate-spin text-blue-500" />;
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "skipped":
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getNodeInfo = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data;
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Execution Preview</CardTitle>
        <div className="flex gap-2">
          {!isExecuting ? (
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={executionOrder.length === 0}
            >
              <Play className="mr-1 h-4 w-4" />
              Execute
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={handleStop}>
              <Pause className="mr-1 h-4 w-4" />
              Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={isExecuting || executionSteps.length === 0}
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="flow" className="h-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="flow">Execution Flow</TabsTrigger>
            <TabsTrigger value="logs">Execution Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="flow" className="mt-0">
            <ScrollArea className="h-[calc(100vh-300px)]">
              <div className="p-4">
                {executionOrder.length > 0 ? (
                  <div className="space-y-2">
                    {executionOrder.map((nodeId, index) => {
                      const nodeData = getNodeInfo(nodeId);
                      const step = executionSteps[index];
                      const isActive = currentStep === index;

                      return (
                        <div key={nodeId}>
                          <div
                            className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                              isActive ? "border-primary bg-accent" : ""
                            }`}
                          >
                            {step
                              ? getStatusIcon(step.status)
                              : getStatusIcon("pending")}
                            <div className="flex-1">
                              <div className="font-medium">
                                {nodeData?.label}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {nodeData?.description}
                              </div>
                            </div>
                            {nodeData?.type ? (
                              <Badge variant="outline" className="text-xs">
                                {String(nodeData.type)}
                              </Badge>
                            ) : null}
                          </div>
                          {index < executionOrder.length - 1 && (
                            <div className="my-1 ml-6">
                              <ArrowRight className="text-muted-foreground h-4 w-4" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    No execution flow defined. Add nodes and connect them to
                    create a flow.
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="logs" className="mt-0">
            <ScrollArea className="h-[calc(100vh-300px)]">
              <div className="p-4">
                {executionSteps.length > 0 ? (
                  <div className="space-y-4">
                    {executionSteps.map((step, index) => {
                      const nodeData = getNodeInfo(step.nodeId);
                      if (step.status === "pending") return null;

                      return (
                        <div key={index} className="space-y-2">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(step.status)}
                            <span className="font-medium">
                              {nodeData?.label}
                            </span>
                            {step.startTime && step.endTime && (
                              <Badge variant="outline" className="text-xs">
                                {step.endTime.getTime() -
                                  step.startTime.getTime()}
                                ms
                              </Badge>
                            )}
                          </div>
                          {step.input && (
                            <div className="bg-muted rounded p-2">
                              <div className="text-xs font-medium">Input:</div>
                              <pre className="text-xs">
                                {JSON.stringify(step.input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {step.output && (
                            <div className="bg-muted rounded p-2">
                              <div className="text-xs font-medium">Output:</div>
                              <pre className="text-xs">
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {step.error && (
                            <div className="bg-destructive/10 text-destructive rounded p-2">
                              <div className="text-xs font-medium">Error:</div>
                              <div className="text-xs">{step.error}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    No execution logs yet. Run the flow to see logs.
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
