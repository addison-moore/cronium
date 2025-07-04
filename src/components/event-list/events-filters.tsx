"use client";

import { useTranslations } from "next-intl";
import { EventStatus, EventType } from "@/shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboBox } from "@/components/ui/combo-box";
import { Search, X, ArrowUp, ArrowDown } from "lucide-react";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import { Event, ServerData, WorkflowData, EventListFilters } from "./types";

interface EventsFiltersProps {
  filters: EventListFilters;
  onFiltersChange: (filters: Partial<EventListFilters>) => void;
  onClearFilters: () => void;
  events: Event[];
  servers: ServerData[];
  workflows: WorkflowData[];
}

export function EventsFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  events,
  servers,
  workflows,
}: EventsFiltersProps) {
  const t = useTranslations("Events");

  // Extract all unique tags from events for filter options
  const allTags = Array.from(
    new Set(
      events
        .filter((event) => event.tags && Array.isArray(event.tags))
        .flatMap((event) => event.tags!),
    ),
  ).sort();

  // Prepare tag options for ComboBox
  const tagOptions = [
    { label: t("AllTags"), value: "all" },
    ...allTags.map((tag) => ({ label: tag, value: tag })),
  ];

  // Prepare workflow options for ComboBox
  const workflowOptions = [
    { label: "All Workflows", value: "all" },
    ...(workflows || []).map((workflow) => ({
      label: workflow.name,
      value: workflow.id.toString(),
    })),
  ];

  // Define filter options for the filter bar
  const sortOptions = [
    { value: "name", label: t("Alphabetical") || "Alphabetical" },
    { value: "createdAt", label: t("DateCreated") || "Date Created" },
    { value: "lastRunAt", label: t("LastExecution") || "Last Execution" },
  ];

  return (
    <div className="mb-4 space-y-4">
      {/* Responsive Grid Layout for Filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Search Bar - spans 1 column */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            {t("Search")}
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("SearchPlaceholder")}
              value={filters.searchTerm}
              onChange={(e) => {
                onFiltersChange({ searchTerm: e.target.value });
              }}
              className="pl-8 pr-8"
            />
            {filters.searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-9 w-9 p-0"
                onClick={() => onFiltersChange({ searchTerm: "" })}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear search</span>
              </Button>
            )}
          </div>
        </div>

        {/* Sort By */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            {t("SortBy") || "Sort By"}
          </label>
          <div className="flex gap-2">
            <Select
              value={filters.sortBy}
              onValueChange={(value: "name" | "createdAt" | "lastRunAt") => {
                onFiltersChange({ sortBy: value });
              }}
            >
              <SelectTrigger className="w-full h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border shadow-lg rounded-md overflow-hidden">
                {sortOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-10 p-0 flex-shrink-0"
              onClick={() => {
                onFiltersChange({
                  sortOrder: filters.sortOrder === "asc" ? "desc" : "asc",
                });
              }}
              title={
                filters.sortOrder === "asc"
                  ? "Sort Ascending"
                  : "Sort Descending"
              }
            >
              {filters.sortOrder === "asc" ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Event Type */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            {t("EventType")}
          </label>
          <Select
            value={filters.typeFilter}
            onValueChange={(value) => {
              onFiltersChange({ typeFilter: value });
            }}
          >
            <SelectTrigger className="w-full h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all text-foreground">
              <SelectValue placeholder={t("AllTypes")} />
            </SelectTrigger>
            <SelectContent className="bg-background border border-border shadow-lg rounded-md overflow-hidden">
              <SelectItem
                value="all"
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm font-medium text-foreground "
              >
                {t("AllTypes")}
              </SelectItem>
              <SelectItem
                value={EventType.NODEJS}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <EventTypeIcon
                    type={EventType.NODEJS}
                    size={16}
                    className="mr-2"
                  />
                  {t("NodeJS")}
                </div>
              </SelectItem>
              <SelectItem
                value={EventType.PYTHON}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <EventTypeIcon
                    type={EventType.PYTHON}
                    size={16}
                    className="mr-2"
                  />
                  {t("Python")}
                </div>
              </SelectItem>
              <SelectItem
                value={EventType.BASH}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <EventTypeIcon
                    type={EventType.BASH}
                    size={16}
                    className="mr-2"
                  />
                  {t("Bash")}
                </div>
              </SelectItem>
              <SelectItem
                value={EventType.HTTP_REQUEST}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <EventTypeIcon
                    type={EventType.HTTP_REQUEST}
                    size={16}
                    className="mr-2"
                  />
                  {t("HttpRequest")}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Status */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            {t("StatusLabel")}
          </label>
          <Select
            value={filters.statusFilter}
            onValueChange={(value) => {
              onFiltersChange({ statusFilter: value });
            }}
          >
            <SelectTrigger className="w-full h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all text-foreground">
              <SelectValue placeholder={t("AllStatuses")} />
            </SelectTrigger>
            <SelectContent className="bg-background border border-border shadow-lg rounded-md overflow-hidden">
              <SelectItem
                value="all"
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm font-medium text-foreground "
              >
                {t("AllStatuses")}
              </SelectItem>
              <SelectItem
                value={EventStatus.ACTIVE}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-green-500 mr-2"></span>
                  {t("StatusActive")}
                </div>
              </SelectItem>
              <SelectItem
                value={EventStatus.PAUSED}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-yellow-500 mr-2"></span>
                  {t("StatusPaused")}
                </div>
              </SelectItem>
              <SelectItem
                value={EventStatus.DRAFT}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-gray-500 mr-2"></span>
                  {t("StatusDraft")}
                </div>
              </SelectItem>
              <div className="border-t border-border my-1"></div>
              <SelectItem
                value={EventStatus.ARCHIVED}
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-slate-400 mr-2"></span>
                  {t("StatusArchived")}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Execution Server */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            {t("ExecutionServer")}
          </label>
          <Select
            value={filters.serverFilter}
            onValueChange={(value) => {
              onFiltersChange({ serverFilter: value });
            }}
          >
            <SelectTrigger className="w-full h-10 rounded-md focus:ring-2 focus:ring-primary/20 transition-all text-foreground">
              <SelectValue placeholder={t("AllServers")} />
            </SelectTrigger>
            <SelectContent className="bg-background border border-border shadow-lg rounded-md overflow-hidden">
              <SelectItem
                value="all"
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm font-medium text-foreground "
              >
                {t("AllServers")}
              </SelectItem>
              <SelectItem
                value="local"
                className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
              >
                <div className="flex items-center">
                  <span className="flex h-2 w-2 rounded-full bg-blue-500 mr-2"></span>
                  Local
                </div>
              </SelectItem>
              {servers.map((server) => (
                <SelectItem
                  key={server.id}
                  value={server.id.toString()}
                  className="hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground py-2 pl-8 pr-3 text-sm text-foreground "
                >
                  <div className="flex items-center">
                    <span className="flex h-2 w-2 rounded-full bg-green-500 mr-2"></span>
                    {server.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Workflow */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            Workflow
          </label>
          <ComboBox
            options={workflowOptions}
            value={filters.workflowFilter}
            onChange={(value) => {
              onFiltersChange({ workflowFilter: value });
            }}
            placeholder="All Workflows"
            emptyMessage="No workflows found"
            className="w-full"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">
            {t("Tags")}
          </label>
          <ComboBox
            options={tagOptions}
            value={filters.tagFilter}
            onChange={(value) => {
              onFiltersChange({ tagFilter: value });
            }}
            placeholder={t("AllTags")}
            emptyMessage="No tags found"
            className="w-full"
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onClearFilters}
            className="h-10 w-full"
          >
            <X className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        </div>
      </div>
    </div>
  );
}
