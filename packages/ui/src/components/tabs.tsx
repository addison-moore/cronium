import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "bg-muted text-foreground border-border bg-secondary-bg flex h-auto w-full flex-wrap items-center justify-center gap-1 rounded-md border p-1 sm:gap-2 md:p-2",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "ring-offset-background focus-visible:ring-ring bg-background text-foreground hover:bg-muted hover:text-primary/80 data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-border data-[state=active]:border-primary mb-1 inline-flex items-center justify-center rounded-md border px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200 hover:cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:mb-0 data-[state=active]:border-b-4 data-[state=active]:shadow-sm sm:px-3",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

interface SettingsTabProps {
  value: string;
  icon?: LucideIcon | React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  className?: string;
  iconClassName?: string;
}

const Tab = ({
  value,
  icon: Icon,
  label,
  className = "",
  iconClassName = "",
}: SettingsTabProps) => {
  return (
    <TabsTrigger
      value={value}
      className={`flex min-w-min flex-1 items-center ${className}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 sm:mr-2 sm:h-4 sm:w-4 ${iconClassName}`} />
      )}
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
};

export { Tabs, TabsList, TabsTrigger, TabsContent, Tab };
