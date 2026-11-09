"use client";

import { useState } from "react";
import { Button } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Search, Filter, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  JOB_SEARCH_MAX_LENGTH,
  JOB_STATUS_OPTIONS,
  JOB_TYPE_OPTIONS,
  NO_JOB_FILTERS,
  jobListQuery,
  type JobListFilters,
} from "@/shared/job-list-filters";

interface JobFiltersProps {
  /**
   * The filters the page's address asks for, already checked. The controls start
   * from these, so a reload or a shared link shows what the list is filtered by.
   */
  initial?: JobListFilters;
}

export function JobFilters({ initial = NO_JOB_FILTERS }: JobFiltersProps) {
  const router = useRouter();
  const [status, setStatus] = useState<JobListFilters["status"]>(
    initial.status,
  );
  const [type, setType] = useState<JobListFilters["type"]>(initial.type);
  const [search, setSearch] = useState(initial.search);

  const handleApplyFilters = () => {
    const queryString = jobListQuery({ search, status, type });
    router.push(`/dashboard/jobs${queryString ? `?${queryString}` : ""}`);
  };

  const handleReset = () => {
    setStatus("all");
    setType("all");
    setSearch("");
    router.push("/dashboard/jobs");
  };

  const handleRefresh = () => {
    router.refresh();
  };

  return (
    <div className="border-border space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-medium">
          <Filter className="h-5 w-5" />
          Filters
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="search" className="sr-only">
            Search
          </Label>
          <div className="relative">
            <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
            <Input
              id="search"
              placeholder="Job ID or Event ID"
              value={search}
              maxLength={JOB_SEARCH_MAX_LENGTH}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // Not while an input method is still composing text: its Enter
                // picks the characters.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  handleApplyFilters();
                }
              }}
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="status" className="sr-only">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as JobListFilters["status"])
            }
          >
            <SelectTrigger id="status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {JOB_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="type" className="sr-only">
            Type
          </Label>
          <Select
            value={type}
            onValueChange={(value) => setType(value as JobListFilters["type"])}
          >
            <SelectTrigger id="type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {JOB_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Button onClick={handleApplyFilters} className="flex-1">
            Apply Filters
          </Button>
          <Button variant="outline" onClick={handleReset}>
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
