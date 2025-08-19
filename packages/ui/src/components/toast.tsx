import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "../lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:top-auto sm:right-0 sm:bottom-0 sm:flex-col md:max-w-[420px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full toast",
  {
    variants: {
      variant: {
        default: "info-toast",
        destructive: "destructive-toast",
        success: "success-toast",
        warning: "warning-toast",
        info: "info-toast",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      data-variant={variant}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50",
      "group-[.destructive-toast]:border-red-200 group-[.destructive-toast]:bg-white group-[.destructive-toast]:text-red-700 group-[.destructive-toast]:hover:bg-red-100 group-[.destructive-toast]:focus:ring-red-500 dark:group-[.destructive-toast]:border-red-800 dark:group-[.destructive-toast]:bg-gray-800 dark:group-[.destructive-toast]:text-red-300 dark:group-[.destructive-toast]:hover:bg-red-900/30",
      "group-[.success-toast]:border-green-200 group-[.success-toast]:bg-white group-[.success-toast]:text-green-700 group-[.success-toast]:hover:bg-green-100 group-[.success-toast]:focus:ring-green-500 dark:group-[.success-toast]:border-green-800 dark:group-[.success-toast]:bg-gray-800 dark:group-[.success-toast]:text-green-300 dark:group-[.success-toast]:hover:bg-green-900/30",
      "group-[.warning-toast]:border-amber-200 group-[.warning-toast]:bg-white group-[.warning-toast]:text-amber-700 group-[.warning-toast]:hover:bg-amber-100 group-[.warning-toast]:focus:ring-amber-500 dark:group-[.warning-toast]:border-amber-800 dark:group-[.warning-toast]:bg-gray-800 dark:group-[.warning-toast]:text-amber-300 dark:group-[.warning-toast]:hover:bg-amber-900/30",
      "group-[.info-toast]:border-blue-200 group-[.info-toast]:bg-white group-[.info-toast]:text-blue-700 group-[.info-toast]:hover:bg-blue-100 group-[.info-toast]:focus:ring-blue-500 dark:group-[.info-toast]:border-blue-800 dark:group-[.info-toast]:bg-gray-800 dark:group-[.info-toast]:text-blue-300 dark:group-[.info-toast]:hover:bg-blue-900/30",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute top-2 right-2 rounded-md p-1 opacity-70 transition-opacity group-hover:opacity-100 hover:opacity-100 focus:opacity-100 focus:ring-2 focus:outline-none",
      "group-[.destructive-toast]:text-red-600 group-[.destructive-toast]:hover:text-red-700 group-[.destructive-toast]:focus:ring-red-500 dark:group-[.destructive-toast]:text-red-400 dark:group-[.destructive-toast]:hover:text-red-300",
      "group-[.success-toast]:text-green-600 group-[.success-toast]:hover:text-green-700 group-[.success-toast]:focus:ring-green-500 dark:group-[.success-toast]:text-green-400 dark:group-[.success-toast]:hover:text-green-300",
      "group-[.warning-toast]:text-amber-600 group-[.warning-toast]:hover:text-amber-700 group-[.warning-toast]:focus:ring-amber-500 dark:group-[.warning-toast]:text-amber-400 dark:group-[.warning-toast]:hover:text-amber-300",
      "group-[.info-toast]:text-blue-600 group-[.info-toast]:hover:text-blue-700 group-[.info-toast]:focus:ring-blue-500 dark:group-[.info-toast]:text-blue-400 dark:group-[.info-toast]:hover:text-blue-300",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
