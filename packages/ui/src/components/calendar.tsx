"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const today = new Date();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      footer={
        <div className="mt-4 flex justify-center">
          <button
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "text-sm",
            )}
            onClick={(e) => {
              e.preventDefault();

              // If we have a month change handler, set the view to current month
              if (props.onMonthChange) {
                props.onMonthChange(today);
              }

              // If the calendar is in single mode, select today's date
              if ("onSelect" in props && typeof props.onSelect === "function") {
                // @ts-expect-error - onSelect type mismatch with react-day-picker
                props.onSelect(today, today, {}, new MouseEvent("click"));
              }
            }}
          >
            Today
          </button>
        </div>
      }
      classNames={{
        // react-day-picker v10 UI keys (the pre-v9 names — caption, nav_button,
        // head_row, day_selected, ... — were removed with the deprecated
        // aliases; same visual mapping, current names)
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
          "absolute left-1",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
          "absolute right-1",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex w-full justify-start [&>*]:flex-1",
        weekday:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center",
        week: "flex w-full mt-2 justify-start [&>*]:flex-1",
        day: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
        ),
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        PreviousMonthButton: (props) => {
          // Remove popover prop to avoid TypeScript error with newer React types
          const { popover: _popover, ...buttonProps } = props as {
            popover?: unknown;
          } & React.ButtonHTMLAttributes<HTMLButtonElement>;
          return (
            <button {...buttonProps}>
              <ChevronLeft className="h-4 w-4" />
            </button>
          );
        },
        NextMonthButton: (props) => {
          // Remove popover prop to avoid TypeScript error with newer React types
          const { popover: _popover, ...buttonProps } = props as {
            popover?: unknown;
          } & React.ButtonHTMLAttributes<HTMLButtonElement>;
          return (
            <button {...buttonProps}>
              <ChevronRight className="h-4 w-4" />
            </button>
          );
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
