import React from "react";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@cronium/ui";
import { Input } from "@cronium/ui";
import {
  type UseFormReturn,
  type FieldValues,
  type Path,
  type ControllerProps,
} from "react-hook-form";

interface FormFieldWrapperProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  description?: string;
  type?: string;
  className?: string;
  disabled?: boolean;
  render?: ControllerProps<T>["render"];
}

export function FormFieldWrapper<T extends FieldValues>({
  form,
  name,
  label,
  placeholder,
  description,
  type = "text",
  className = "",
  disabled = false,
  render,
}: FormFieldWrapperProps<T>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={
        render ??
        (({ field }) => (
          <FormItem className={className}>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Input
                type={type}
                placeholder={placeholder}
                disabled={disabled}
                {...field}
              />
            </FormControl>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        ))
      }
    />
  );
}
