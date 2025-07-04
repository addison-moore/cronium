"use client";

interface LoadingStateProps {
  text?: string;
  size?: "sm" | "md" | "lg";
  spinnerOnly?: boolean;
  minHeight?: string;
  className?: string;
}

/**
 * A reusable loading state component with customizable spinner and text
 */
export function LoadingState({
  text = "Loading...",
  size = "md",
  spinnerOnly = false,
  minHeight = "20rem",
  className = "",
}: LoadingStateProps) {
  const spinnerSizes = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-8 h-8 border-3",
  };

  const textSizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  return (
    <div
      className={`flex items-center justify-center ${minHeight ? `min-h-[${minHeight}]` : ""} ${className}`}
    >
      <div className="text-center">
        <div
          className={`border-t-primary rounded-full animate-spin mx-auto mb-2 ${spinnerSizes[size]}`}
        ></div>
        {!spinnerOnly && (
          <p className={`text-muted-foreground ${textSizes[size]}`}>{text}</p>
        )}
      </div>
    </div>
  );
}
