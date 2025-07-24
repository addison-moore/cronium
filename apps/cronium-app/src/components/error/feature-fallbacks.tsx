import React, { type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Alert, AlertDescription } from "@cronium/ui";
import { Button } from "@cronium/ui";
import {
  FileText,
  Terminal,
  Workflow,
  BarChart,
  Code,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

// ============================================
// Monaco Editor Fallback
// ============================================

export function MonacoEditorFallback({
  value,
  onChange,
  language = "javascript",
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="border-border bg-muted/50 rounded-md border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Code className="h-4 w-4" />
          <span>Code Editor ({language})</span>
        </div>
        {!readOnly && (
          <span className="text-muted-foreground text-xs">
            Using basic editor - Advanced features unavailable
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        className="border-border bg-background min-h-[300px] w-full resize-y rounded border p-3 font-mono text-sm"
        placeholder={readOnly ? "" : "Enter your code here..."}
      />
    </div>
  );
}

// ============================================
// Terminal Fallback
// ============================================

export function TerminalFallback({
  logs = [],
  onCommand,
}: {
  logs?: string[];
  onCommand?: (command: string) => void;
}) {
  const [command, setCommand] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (command.trim() && onCommand) {
      onCommand(command);
      setCommand("");
    }
  };

  return (
    <div className="border-border rounded-md border bg-black p-4 text-green-400">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Terminal className="h-4 w-4" />
        <span>Terminal (Basic Mode)</span>
      </div>
      <div className="max-h-[300px] space-y-1 overflow-y-auto font-mono text-sm">
        {logs.map((log, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {log}
          </div>
        ))}
      </div>
      {onCommand && (
        <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
          <span className="text-green-400">$</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="flex-1 bg-transparent outline-none"
            placeholder="Enter command..."
          />
        </form>
      )}
    </div>
  );
}

// ============================================
// Workflow Canvas Fallback
// ============================================

export function WorkflowCanvasFallback({
  nodes = [],
  onNodeClick,
}: {
  nodes?: Array<{ id: string; label: string; type: string }>;
  onNodeClick?: (nodeId: string) => void;
}) {
  return (
    <div className="border-border min-h-[400px] rounded-md border p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow className="h-5 w-5" />
          <span className="font-medium">Workflow View (Simplified)</span>
        </div>
        <Alert className="w-auto">
          <AlertDescription className="text-xs">
            Interactive canvas unavailable. Showing list view.
          </AlertDescription>
        </Alert>
      </div>
      <div className="space-y-2">
        {nodes.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">
            No workflow nodes to display
          </p>
        ) : (
          nodes.map((node) => (
            <Card
              key={node.id}
              className="hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => onNodeClick?.(node.id)}
            >
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="bg-primary h-2 w-2 rounded-full" />
                  {node.label}
                </CardTitle>
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================
// Chart Fallback
// ============================================

export function ChartFallback({
  data = [],
  title,
  type: _type = "bar",
}: {
  data?: Array<{ label: string; value: number }>;
  title?: string;
  type?: "bar" | "line" | "pie";
}) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart className="h-5 w-5" />
          {title ?? "Chart"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className="mb-4">
          <AlertDescription className="text-sm">
            Interactive charts unavailable. Showing simplified view.
          </AlertDescription>
        </Alert>
        <div className="space-y-3">
          {data.map((item, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{item.label}</span>
                <span className="font-mono">{item.value}</span>
              </div>
              <div className="bg-muted h-2 w-full rounded-full">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(item.value / maxValue) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// Generic Feature Fallback
// ============================================

export function FeatureFallback({
  featureName,
  icon: Icon = FileText,
  children,
  onRetry,
  showRetry = true,
  customMessage,
}: {
  featureName: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: ReactNode;
  onRetry?: () => void;
  showRetry?: boolean;
  customMessage?: string;
}) {
  return (
    <Card className="border-border border-dashed">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="bg-muted mb-4 rounded-full p-3">
            <Icon className="text-muted-foreground h-8 w-8" />
          </div>
          <h3 className="mb-2 font-semibold">{featureName} Unavailable</h3>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">
            {customMessage ??
              `The ${featureName} feature couldn't be loaded. You can still use basic functionality.`}
          </p>
          {showRetry && onRetry && (
            <Button onClick={onRetry} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}
          {children && <div className="mt-6 w-full">{children}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// Loading State with Timeout Fallback
// ============================================

export function TimeoutFallback({
  timeout = 10000,
  onTimeout,
  fallback,
  children,
}: {
  timeout?: number;
  onTimeout?: () => void;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const [isTimedOut, setIsTimedOut] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsTimedOut(true);
      onTimeout?.();
    }, timeout);

    return () => clearTimeout(timer);
  }, [timeout, onTimeout]);

  if (isTimedOut) {
    return (
      <div>
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This is taking longer than expected. Showing simplified version.
          </AlertDescription>
        </Alert>
        {fallback}
      </div>
    );
  }

  return <>{children}</>;
}
