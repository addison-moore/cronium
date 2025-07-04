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
    <div className="space-y-4 mb-6">
      {/* Filter Controls Row */}
      <div className="flex flex-wrap gap-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search servers..."
            value={filters.searchTerm}
            onChange={(e) => onFiltersChange({ searchTerm: e.target.value })}
            className="pl-10 h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        {/* Status Filter */}
        <div className="w-[180px]">
          <Select
            value={filters.statusFilter}
            onValueChange={(value) => onFiltersChange({ statusFilter: value })}
          >
            <SelectTrigger className="w-full h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="bg-background border border-border shadow-lg rounded-md overflow-hidden">
              <SelectItem
                value="all"
                className="hover:bg-muted py-2 pl-8 pr-3 text-sm font-medium"
              >
                All Statuses
              </SelectItem>
              <SelectItem
                value="online"
                className="hover:bg-muted py-2 pl-8 pr-3 text-sm"
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-green-500 mr-2"></span>
                  Online
                </div>
              </SelectItem>
              <SelectItem
                value="offline"
                className="hover:bg-muted py-2 pl-8 pr-3 text-sm"
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-red-500 mr-2"></span>
                  Offline
                </div>
              </SelectItem>
              <SelectItem
                value="unknown"
                className="hover:bg-muted py-2 pl-8 pr-3 text-sm"
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-gray-500 mr-2"></span>
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
            <SelectTrigger className="w-[180px] h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="bg-background border border-border shadow-lg rounded-md overflow-hidden">
              {sortOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="hover:bg-muted py-2 pl-8 pr-3 text-sm"
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
            className="px-3 h-10"
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
