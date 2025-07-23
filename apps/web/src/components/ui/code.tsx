import React from "react";
import { cn } from "@/lib/utils";

export interface CodeProps extends React.HTMLAttributes<HTMLPreElement> {
  language?: string;
}

export const Code = React.forwardRef<HTMLPreElement, CodeProps>(
  ({ children, className, language, ...props }, ref) => {
    return (
      <pre
        ref={ref}
        className={cn(
          "bg-muted rounded-md px-4 py-3 font-mono text-sm",
          className,
        )}
        data-language={language}
        {...props}
      >
        <code>{children}</code>
      </pre>
    );
  },
);

Code.displayName = "Code";
