"use client";

import React, { Component, type ReactNode, useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Info, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================
// Graceful Degradation Types
// ============================================

interface NetworkInformation {
  effectiveType: string;
  addEventListener(type: string, listener: () => void): void;
}

export interface GracefulDegradationProps {
  children: ReactNode;
  fallback?: ReactNode;
  minimalFallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  className?: string;
  showError?: boolean;
  enableProgressive?: boolean;
}

interface GracefulDegradationState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  degradationLevel: "full" | "partial" | "minimal";
  attemptedRecovery: boolean;
}

// ============================================
// Main Graceful Degradation Component
// ============================================

export class GracefulDegradation extends Component<
  GracefulDegradationProps,
  GracefulDegradationState
> {
  constructor(props: GracefulDegradationProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      degradationLevel: "full",
      attemptedRecovery: false,
    };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<GracefulDegradationState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Graceful degradation caught error:", error, errorInfo);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);

    // Attempt to determine degradation level based on error type
    const degradationLevel = this.determineDegradationLevel(error);
    this.setState({ degradationLevel });
  }

  determineDegradationLevel(error: Error): "full" | "partial" | "minimal" {
    // Network errors - try partial degradation
    if (error.message.includes("fetch") || error.message.includes("network")) {
      return "partial";
    }

    // Chunk loading errors - minimal degradation
    if (
      error.message.includes("Loading chunk") ||
      error.message.includes("import")
    ) {
      return "minimal";
    }

    // Default to full degradation for unknown errors
    return "full";
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      degradationLevel: "full",
      attemptedRecovery: true,
    });
  };

  render() {
    const { hasError, error, degradationLevel, attemptedRecovery } = this.state;
    const {
      children,
      fallback,
      minimalFallback,
      showError = true,
      className,
    } = this.props;

    if (!hasError) {
      return children;
    }

    // Minimal degradation - show basic content only
    if (degradationLevel === "minimal" && minimalFallback) {
      return (
        <div className={cn("relative", className)}>
          {showError && (
            <Alert className="mb-4">
              <Info className="h-4 w-4" />
              <AlertTitle>Limited functionality</AlertTitle>
              <AlertDescription>
                Some features are unavailable. Basic functionality is still
                accessible.
              </AlertDescription>
            </Alert>
          )}
          {minimalFallback}
        </div>
      );
    }

    // Partial degradation - show fallback content
    if (degradationLevel === "partial" && fallback) {
      return (
        <div className={cn("relative", className)}>
          {showError && (
            <Alert variant="default" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Reduced functionality</AlertTitle>
              <AlertDescription>
                {error?.message ?? "Some features may not work as expected."}
                {!attemptedRecovery && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={this.handleReset}
                    className="ml-2 h-auto p-0"
                  >
                    Try full version
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {fallback}
        </div>
      );
    }

    // Full degradation - show error state
    return (
      <div className={cn("p-4", className)}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            <p>{error?.message ?? "An unexpected error occurred."}</p>
            {attemptedRecovery && (
              <p className="text-sm">
                Recovery attempted but failed. Please refresh the page.
              </p>
            )}
            <Button
              onClick={this.handleReset}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}

// ============================================
// Progressive Enhancement Component
// ============================================

interface ProgressiveEnhancementProps {
  children: ReactNode;
  enhanced: ReactNode;
  onError?: (error: Error) => void;
  delay?: number;
}

export function ProgressiveEnhancement({
  children,
  enhanced,
  onError,
  delay = 0,
}: ProgressiveEnhancementProps) {
  const [isEnhanced, setIsEnhanced] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setIsEnhanced(true);
      } catch (error) {
        console.error("Progressive enhancement failed:", error);
        setHasError(true);
        onError?.(error as Error);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, onError]);

  if (hasError || !isEnhanced) {
    return <>{children}</>;
  }

  return (
    <GracefulDegradation
      fallback={children}
      onError={(error) => {
        setHasError(true);
        setIsEnhanced(false);
        onError?.(error);
      }}
    >
      {enhanced}
    </GracefulDegradation>
  );
}

// ============================================
// Feature Detection Wrapper
// ============================================

interface FeatureDetectionProps {
  children: ReactNode;
  fallback: ReactNode;
  features: string[];
  onUnsupported?: (missing: string[]) => void;
}

export function FeatureDetection({
  children,
  fallback,
  features,
  onUnsupported,
}: FeatureDetectionProps) {
  const [isSupported, setIsSupported] = useState(true);
  const [missingFeatures, setMissingFeatures] = useState<string[]>([]);

  useEffect(() => {
    const missing: string[] = [];

    features.forEach((feature) => {
      if (!checkFeatureSupport(feature)) {
        missing.push(feature);
      }
    });

    if (missing.length > 0) {
      setIsSupported(false);
      setMissingFeatures(missing);
      onUnsupported?.(missing);
    }
  }, [features, onUnsupported]);

  if (!isSupported) {
    return (
      <div>
        {missingFeatures.length > 0 && (
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertTitle>Browser compatibility</AlertTitle>
            <AlertDescription>
              Your browser doesn't support: {missingFeatures.join(", ")}. Some
              features have been disabled.
            </AlertDescription>
          </Alert>
        )}
        {fallback}
      </div>
    );
  }

  return <>{children}</>;
}

// Helper function to check feature support
function checkFeatureSupport(feature: string): boolean {
  switch (feature) {
    case "webgl":
      try {
        const canvas = document.createElement("canvas");
        return !!(
          window.WebGLRenderingContext &&
          (canvas.getContext("webgl") ??
            canvas.getContext("experimental-webgl"))
        );
      } catch {
        return false;
      }
    case "websocket":
      return "WebSocket" in window;
    case "intersectionObserver":
      return "IntersectionObserver" in window;
    case "serviceWorker":
      return "serviceWorker" in navigator;
    case "webworker":
      return typeof Worker !== "undefined";
    default:
      return true;
  }
}

// ============================================
// Network-Aware Component
// ============================================

export function NetworkAwareComponent({
  children,
  offlineFallback,
  slowConnectionFallback,
  onConnectionChange,
}: {
  children: ReactNode;
  offlineFallback: ReactNode;
  slowConnectionFallback?: ReactNode;
  onConnectionChange?: (isOnline: boolean, connectionType?: string) => void;
}) {
  const [isOnline, setIsOnline] = useState(
    typeof window !== "undefined" ? navigator.onLine : true,
  );
  const [isSlowConnection, setIsSlowConnection] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      onConnectionChange?.(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
      onConnectionChange?.(false);
    };

    // Check connection speed
    if ("connection" in navigator) {
      const connection = (
        navigator as unknown as { connection: NetworkInformation }
      ).connection;
      const updateConnectionStatus = () => {
        const effectiveType = connection.effectiveType;
        setIsSlowConnection(
          effectiveType === "2g" || effectiveType === "slow-2g",
        );
        onConnectionChange?.(isOnline, effectiveType);
      };

      connection.addEventListener("change", updateConnectionStatus);
      updateConnectionStatus();
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [isOnline, onConnectionChange]);

  if (!isOnline) {
    return (
      <div>
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>You're offline</AlertTitle>
          <AlertDescription>
            Check your internet connection to access all features.
          </AlertDescription>
        </Alert>
        {offlineFallback}
      </div>
    );
  }

  if (isSlowConnection && slowConnectionFallback) {
    return (
      <div>
        <Alert className="mb-4">
          <Info className="h-4 w-4" />
          <AlertTitle>Slow connection detected</AlertTitle>
          <AlertDescription>
            Some features have been optimized for your connection speed.
          </AlertDescription>
        </Alert>
        {slowConnectionFallback}
      </div>
    );
  }

  return <>{children}</>;
}
