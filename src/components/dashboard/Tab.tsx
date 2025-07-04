import React from "react";
import { TabsTrigger } from "@/components/ui/tabs";
import { LucideIcon } from "lucide-react";

interface SettingsTabProps {
  value: string;
  icon: LucideIcon;
  label: string;
  className?: string;
}

export function Tab({
  value,
  icon: Icon,
  label,
  className = "",
}: SettingsTabProps) {
  return (
    <TabsTrigger
      value={value}
      className={`flex items-center flex-1 min-w-min ${className}`}
    >
      <Icon className="h-4 w-4 sm:mr-2 sm:h-4 sm:w-4" />
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
}
