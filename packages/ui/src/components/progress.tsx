import * as React from "react";

import { cn } from "../lib/utils";

const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    value?: number;
    max?: number;
    indicatorColor?: string;
  }
>(({ className, value, max = 100, indicatorColor, ...props }, ref) => {
  const percentage = value != null ? Math.min(Math.max(0, value), max) : 0;

  return (
    <div
      ref={ref}
      className={cn(
        "bg-secondary relative h-2 w-full overflow-hidden rounded-full",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "bg-primary h-full w-full flex-1 transition-all",
          indicatorColor,
        )}
        style={{ width: `${(percentage / max) * 100}%` }}
      />
    </div>
  );
});
Progress.displayName = "Progress";

export { Progress };
