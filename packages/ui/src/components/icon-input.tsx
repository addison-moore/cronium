"use client";

import React, { type ReactNode } from "react";
import { Input, type InputProps } from "./input";

interface IconInputProps extends InputProps {
  icon: ReactNode;
}

/**
 * Input component with a prepended icon
 */
export function IconInput({ icon, className = "", ...props }: IconInputProps) {
  return (
    <div className="relative">
      <div className="text-muted-foreground absolute top-2.5 left-2">
        {icon}
      </div>
      <Input className={`pl-8 ${className}`} {...props} />
    </div>
  );
}
