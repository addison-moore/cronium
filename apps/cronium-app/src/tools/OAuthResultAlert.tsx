"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button } from "@cronium/ui";

interface OAuthResult {
  succeeded: boolean;
  message: string;
  canRetry: boolean;
}

/** What /api/oauth/callback sends back when it stops before asking the provider. */
const FAILURES: Record<string, Omit<OAuthResult, "succeeded">> = {
  invalid_state: {
    message: "This connection attempt has expired or was already used.",
    canRetry: true,
  },
  invalid_provider: {
    message:
      "This connection attempt named a provider Cronium doesn't support.",
    canRetry: false,
  },
  oauth_not_configured: {
    message:
      "OAuth for this provider isn't set up on this server. An administrator needs to set its client ID and secret.",
    canRetry: false,
  },
  oauth_callback_failed: {
    message: "Cronium couldn't read the answer it got back from the provider.",
    canRetry: true,
  },
};

function readResult(params: {
  get(name: string): string | null;
}): OAuthResult | null {
  if (params.get("oauth") === "success") {
    return {
      succeeded: true,
      message: "The tool can now use the account you authorized.",
      canRetry: false,
    };
  }

  const error = params.get("error");
  if (!error) return null;

  const known = FAILURES[error];
  if (known) return { succeeded: false, ...known };

  // Only this code carries text. Anyone can put text in a link to this page, so it's
  // shown as a reason under a title of our own, and never for any other code.
  const details = error === "oauth_failed" ? params.get("details") : null;
  return {
    succeeded: false,
    message: details ?? "The connection couldn't be finished.",
    canRetry: true,
  };
}

/**
 * How connecting a tool through OAuth went. The flow ends with a redirect to this page,
 * and the person has come back from another site, so this stays until it's dismissed.
 */
export function OAuthResultAlert() {
  const searchParams = useSearchParams();
  const [result, setResult] = useState(() => readResult(searchParams));

  // Off the address, so a reload doesn't report it again and the reason isn't left in
  // the browser's history. Held in state above because this empties searchParams.
  useEffect(() => {
    if (result) window.history.replaceState(null, "", window.location.pathname);
  }, [result]);

  if (!result) return null;

  return (
    <Alert
      variant={result.succeeded ? "default" : "destructive"}
      className={
        result.succeeded
          ? "border-success/40 bg-success/10 text-success-text [&>svg]:text-success-text pr-12"
          : "pr-12"
      }
    >
      {result.succeeded ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      <AlertTitle>
        {result.succeeded
          ? "Account connected"
          : "Couldn't connect the account"}
      </AlertTitle>
      <AlertDescription className="break-words">
        <p>{result.message}</p>
        {result.canRetry && (
          <p>You can start again with the tool&apos;s Connect button.</p>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="absolute top-2 right-2 h-8 w-8"
        onClick={() => setResult(null)}
      >
        <X className="h-4 w-4" />
      </Button>
    </Alert>
  );
}
