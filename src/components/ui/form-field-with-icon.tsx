"use client";

import type { ReactNode } from "react";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { IconInput } from "@/components/ui/icon-input";
import { type InputProps } from "@/components/ui/input";
import { type Control } from "react-hook-form";

interface FormFieldWithIconProps extends Omit<InputProps, "name"> {
  control: Control<Record<string, unknown>>;
  name: string;
  label: string;
  icon: ReactNode;
  description?: string;
}

/**
 * A standardized form field component with an icon in the input
 */
export function FormFieldWithIcon({
  control,
  name,
  label,
  icon,
  description,
  ...inputProps
}: FormFieldWithIconProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <IconInput icon={icon} {...field} {...inputProps} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
