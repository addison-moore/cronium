import * as React from "react";

import { cn } from "../lib/utils";

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg shadow-sm",
      "bg-secondary-bg text-[var(--card-foreground-color)]",
      "dark:text-[var(--card-foreground-color)]",
      "border border-[var(--border-color)] dark:border-[var(--border-color)]",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col space-y-1.5 p-6",
      "text-[var(--card-foreground-color)]",
      "dark:text-[var(--card-foreground-color)]",
      "border-border/10 border-b",
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl leading-none font-semibold tracking-tight",
      "text-[var(--card-foreground-color)]",
      "dark:text-[var(--card-foreground-color)]",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "text-sm",
      "text-[var(--muted-foreground-color)]",
      "dark:text-[var(--muted-foreground-color)]",
      className,
    )}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "p-6",
      "text-[var(--card-foreground-color)]",
      "dark:text-[var(--card-foreground-color)]",
      className,
    )}
    {...props}
  />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center p-6 pt-0",
      "text-[var(--card-foreground-color)]",
      "dark:text-[var(--card-foreground-color)]",
      className,
    )}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
