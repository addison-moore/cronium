import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "flex w-full flex-wrap gap-1 sm:gap-2 p-1 md:p-2 h-auto items-center justify-center rounded-md bg-muted p-1 text-foreground border border-border bg-secondary-bg",
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
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-2 sm:px-3 py-1.5 text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:cursor-pointer disabled:pointer-events-none disabled:opacity-50 bg-background text-foreground hover:bg-muted hover:text-primary/80 data-[state=active]:bg-primary/10 data-[state=active]:text-primary border border-border data-[state=active]:border-b-4 data-[state=active]:border-primary data-[state=active]:shadow-sm data-[state=active]:mb-0 mb-1",
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
      className={`flex items-center flex-1 min-w-min ${className}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 sm:mr-2 sm:h-4 sm:w-4 ${iconClassName}`} />
      )}
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
};

export { Tabs, TabsList, TabsTrigger, TabsContent, Tab };
