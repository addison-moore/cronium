import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type ComboBoxOption = {
  label: string;
  value: string;
};

interface ComboBoxProps {
  options: ComboBoxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  maxDisplayItems?: number;
}

export function ComboBox({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  emptyMessage = "No results found.",
  className,
  maxDisplayItems = 5,
}: ComboBoxProps) {
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  // Find selected option label for display
  const selectedOption = options.find((option) => option.value === value);
  const displayValue = selectedOption ? selectedOption.label : placeholder;

  // Handle filtering options based on search term
  const filteredOptions = React.useMemo(() => {
    if (!searchTerm) {
      // Apply maxDisplayItems even when not searching
      return options.slice(0, maxDisplayItems);
    }

    const filtered = options.filter((option) =>
      option.label.toLowerCase().includes(searchTerm.toLowerCase()),
    );
    return filtered.slice(0, maxDisplayItems);
  }, [options, searchTerm, maxDisplayItems]);

  // Reset highlighted index when filtered options change
  React.useEffect(() => {
    setHighlightedIndex(-1);
    optionRefs.current = [];
  }, [filteredOptions]);

  // Scroll highlighted option into view
  React.useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [highlightedIndex]);

  // Focus input when popover opens
  React.useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  // Handle option selection
  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setSearchTerm("");
    setOpen(false);
    setHighlightedIndex(-1);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1,
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          handleSelect(filteredOptions[highlightedIndex].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setSearchTerm("");
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div className="relative w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="ComboBox"
            aria-expanded={open}
            className={cn(
              "focus:ring-primary/20 focus:border-primary h-10 w-full justify-between rounded-md border border-gray-300 transition-all hover:cursor-pointer hover:border-gray-400 focus:ring-2 disabled:pointer-events-none dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500",
              className,
            )}
          >
            <span className="w-full truncate">{displayValue}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="border-border bg-background w-full rounded-md border p-0 pb-1 shadow-md"
          align="start"
        >
          <div className="flex items-center border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <Search className="mr-2 h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              className="flex h-8 w-full bg-transparent py-2 text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-50"
            />
          </div>
          <div className="max-h-60 overflow-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                {emptyMessage}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredOptions.map((option, index) => (
                  <div
                    key={option.value}
                    ref={(el) => {
                      if (optionRefs.current) {
                        optionRefs.current[index] = el;
                      }
                    }}
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "flex cursor-pointer items-center rounded-md px-2 py-2 text-sm",
                      "hover:bg-gray-100 dark:hover:bg-gray-800",
                      value === option.value
                        ? "bg-gray-100 dark:bg-gray-800"
                        : "",
                      highlightedIndex === index
                        ? "bg-primary dark:bg-primary/30 border-primary border"
                        : "",
                    )}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span>{option.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
