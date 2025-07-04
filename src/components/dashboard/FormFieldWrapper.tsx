import React from "react";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  UseFormReturn,
  FieldValues,
  Path,
  ControllerProps,
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
        render ||
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
