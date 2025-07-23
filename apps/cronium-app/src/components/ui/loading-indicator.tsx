"use client";

import { RefreshCw } from "lucide-react";

interface LoadingIndicatorProps {
  text?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  iconClassName?: string;
}

/**
 * A reusable loading indicator component with customizable size and text
 */
export function LoadingIndicator({
  text,
  size = "md",
  className = "",
  iconClassName = "",
}: LoadingIndicatorProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-8 w-8",
  };

  const textSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="flex items-center space-x-2">
        <RefreshCw
          className={`animate-spin ${sizeClasses[size]} text-primary ${iconClassName}`}
        />
        {text && <span className={`${textSizeClasses[size]}`}>{text}</span>}
      </div>
    </div>
  );
}
