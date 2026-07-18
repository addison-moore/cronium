"use client";

import React from "react";
import { Button } from "@cronium/ui";
import { TestTube, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface TestResult {
  success: boolean;
  message: string;
}

interface TestConnectionButtonProps {
  /** Normalized tool type, e.g. "slack". */
  type: string;
  /**
   * Form mode: returns the current credential values (without the config
   * name). When provided, the button tests these unsaved credentials — this is
   * the "test before save" path. Omit for a saved tool (see `toolId`).
   */
  getCredentials?: (() => Record<string, unknown>) | undefined;
  /**
   * The saved tool's id. In form mode (editing) it lets the server restore
   * blank secret fields from stored values. Without `getCredentials` the
   * button tests the saved tool as-is (list-view mode).
   */
  toolId?: number | undefined;
  /** Disable while the parent form is invalid, etc. */
  disabled?: boolean | undefined;
  size?: "sm" | "default" | undefined;
  className?: string | undefined;
}

/**
 * One consistent "Test connection" control for every tool. In form mode it
 * runs a live provider check against the credentials being entered; in
 * saved-tool mode it re-tests an existing tool. The result renders inline
 * (green success / red failure) so the user gets feedback without a toast.
 */
export function TestConnectionButton({
  type,
  getCredentials,
  toolId,
  disabled,
  size = "default",
  className,
}: TestConnectionButtonProps) {
  const [result, setResult] = React.useState<TestResult | null>(null);

  const testCredentials = trpc.tools.testCredentials.useMutation({
    onSuccess: (r) => setResult({ success: r.success, message: r.message }),
    onError: (e) => setResult({ success: false, message: e.message }),
  });
  const testSaved = trpc.tools.testConnection.useMutation({
    onSuccess: (r) => setResult({ success: r.success, message: r.message }),
    onError: (e) => setResult({ success: false, message: e.message }),
  });

  const isPending = testCredentials.isPending || testSaved.isPending;
  const isDisabled = (disabled ?? false) || isPending;

  const handleTest = () => {
    setResult(null);
    if (getCredentials) {
      testCredentials.mutate({
        type,
        credentials: getCredentials(),
        ...(toolId != null ? { toolId } : {}),
      });
    } else if (toolId != null) {
      testSaved.mutate({ id: toolId });
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={handleTest}
        disabled={isDisabled}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <TestTube className="mr-2 h-4 w-4" />
        )}
        Test connection
      </Button>
      {result && (
        <p
          className={`mt-2 flex items-center gap-1 text-xs ${
            result.success ? "text-success-text" : "text-destructive-text"
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{result.message}</span>
        </p>
      )}
    </div>
  );
}
