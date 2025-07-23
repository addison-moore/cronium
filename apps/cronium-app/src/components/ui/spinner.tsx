"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type SpinnerSize = "xs" | "sm" | "md" | "lg" | "xl";
export type SpinnerVariant = "default" | "primary" | "secondary" | "muted";

export interface SpinnerProps {
  /**
   * The size of the spinner
   * @default "md"
   */
  size?: SpinnerSize;

  /**
   * The variant/color of the spinner
   * @default "primary"
   */
  variant?: SpinnerVariant;

  /**
   * Optional custom class names
   */
  className?: string;

  /**
   * Show a label next to the spinner
   */
  label?: string;

  /**
   * The direction in which the label appears
   * @default "right"
   */
  labelPosition?: "top" | "right" | "bottom" | "left";
}

/**
 * A reusable spinner component for loading states
 * Automatically adapts to dark/light mode via theme variables
 */
export function Spinner({
  size = "md",
  variant = "primary",
  className,
  label,
  labelPosition = "right",
}: SpinnerProps) {
  // Define sizes for the spinner
  const sizeClasses: Record<SpinnerSize, string> = {
    xs: "w-3 h-3 border-[2px]",
    sm: "w-4 h-4 border-[2px]",
    md: "w-6 h-6 border-[2px]",
    lg: "w-8 h-8 border-[3px]",
    xl: "w-12 h-12 border-[4px]",
  };

  // Define colors based on variant
  const variantClasses: Record<SpinnerVariant, string> = {
    default: "border-foreground/20 border-t-foreground/60",
    primary: "border-primary/20 border-t-primary",
    secondary: "border-secondary/20 border-t-secondary",
    muted: "border-muted/20 border-t-muted-foreground",
  };

  // CSS classes for label positioning
  const labelPositionClasses: Record<
    SpinnerProps["labelPosition"] & string,
    string
  > = {
    top: "flex-col-reverse items-center gap-2",
    right: "flex-row items-center gap-3",
    bottom: "flex-col items-center gap-2",
    left: "flex-row-reverse items-center gap-3",
  };

  // Generate the wrapper class based on whether a label exists
  const wrapperClass = label
    ? cn("flex", labelPositionClasses[labelPosition])
    : "";

  return (
    <div className={wrapperClass}>
      <div
        className={cn(
          "animate-spin rounded-full",
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
      />
      {label && <span className="text-foreground font-medium">{label}</span>}
    </div>
  );
}

/**
 * A wrapper component that adds a centered spinner with optimal spacing
 */
export function SpinnerContainer({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-[100px] w-full items-center justify-center py-8",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
