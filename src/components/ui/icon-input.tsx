"use client";

import React, { ReactNode } from "react";
import { Input, InputProps } from "@/components/ui/input";

interface IconInputProps extends InputProps {
  icon: ReactNode;
}

/**
 * Input component with a prepended icon
 */
export function IconInput({ icon, className = "", ...props }: IconInputProps) {
  return (
    <div className="relative">
      <div className="absolute left-2 top-2.5 text-muted-foreground">
        {icon}
      </div>
      <Input className={`pl-8 ${className}`} {...props} />
    </div>
  );
}
