"use client";

import { Search, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface ServerFilters {
  searchTerm: string;
  statusFilter: string;
  sortBy: string;
  sortOrder: string;
}

interface ServerFiltersProps {
  filters: ServerFilters;
  onFiltersChange: (filters: Partial<ServerFilters>) => void;
  onClearFilters: () => void;
}

export function ServerFilters({
  filters,
  onFiltersChange,
}: ServerFiltersProps) {
  const sortOptions = [
    { value: "name", label: "Name" },
    { value: "createdAt", label: "Date Created" },
    { value: "lastChecked", label: "Last Checked" },
  ];

  return (
    <div className="mb-6 space-y-4">
      {/* Filter Controls Row */}
      <div className="flex flex-wrap gap-4">
        {/* Search */}
        <div className="relative min-w-[300px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
          <Input
            placeholder="Search servers..."
            value={filters.searchTerm}
            onChange={(e) => onFiltersChange({ searchTerm: e.target.value })}
            className="focus:ring-primary/20 h-10 rounded-md pl-10 transition-all focus:ring-2"
          />
        </div>

        {/* Status Filter */}
        <div className="w-[180px]">
          <Select
            value={filters.statusFilter}
            onValueChange={(value) => onFiltersChange({ statusFilter: value })}
          >
            <SelectTrigger className="focus:ring-primary/20 h-10 w-full rounded-md transition-all focus:ring-2">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="bg-background border-border overflow-hidden rounded-md border shadow-lg">
              <SelectItem
                value="all"
                className="hover:bg-muted py-2 pr-3 pl-8 text-sm font-medium"
              >
                All Statuses
              </SelectItem>
              <SelectItem
                value="online"
                className="hover:bg-muted py-2 pr-3 pl-8 text-sm"
              >
                <div className="flex items-center">
                  <span className="mr-2 flex h-2 w-2 rounded-full bg-green-500"></span>
                  Online
                </div>
              </SelectItem>
              <SelectItem
                value="offline"
                className="hover:bg-muted py-2 pr-3 pl-8 text-sm"
              >
                <div className="flex items-center">
                  <span className="mr-2 flex h-2 w-2 rounded-full bg-red-500"></span>
                  Offline
                </div>
              </SelectItem>
              <SelectItem
                value="unknown"
                className="hover:bg-muted py-2 pr-3 pl-8 text-sm"
              >
                <div className="flex items-center">
                  <span className="mr-2 flex h-2 w-2 rounded-full bg-gray-500"></span>
                  Unknown
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Sort By and Sort Order */}
        <div className="flex gap-2">
          <Select
            value={filters.sortBy}
            onValueChange={(value) => onFiltersChange({ sortBy: value })}
          >
            <SelectTrigger className="focus:ring-primary/20 h-10 w-[180px] rounded-md transition-all focus:ring-2">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="bg-background border-border overflow-hidden rounded-md border shadow-lg">
              {sortOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="hover:bg-muted py-2 pr-3 pl-8 text-sm"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort Order Toggle Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onFiltersChange({
                sortOrder: filters.sortOrder === "asc" ? "desc" : "asc",
              })
            }
            className="h-10 px-3"
          >
            {filters.sortOrder === "asc" ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
