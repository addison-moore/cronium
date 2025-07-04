"use client";

import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboBox } from "@/components/ui/combo-box";
import { LogStatus } from "@/shared/schema";
import { ActivityTable } from "./ActivityTable";

interface Script {
  id: number;
  name: string;
}

interface ActivityWithFiltersProps {
  title: string;
  description?: string;
  fetchLogs: (
    params: URLSearchParams,
  ) => Promise<{ logs: any[]; total: number }>;
  fetchScripts: () => Promise<Script[]>;
  fetchWorkflows?: () => Promise<any[]>;
  pageSize?: number;
  className?: string;
}

export function ActivityTableWithFilters({
  title,
  description,
  fetchLogs,
  fetchScripts,
  fetchWorkflows,
  pageSize = 20,
  className = "",
}: ActivityWithFiltersProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [filterEventId, setFilterEventId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterEventOwnership, setFilterEventOwnership] = useState("all");
  const [filterWorkflowId, setFilterWorkflowId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(pageSize);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    loadScripts();
    loadWorkflows();
    loadLogs();
  }, []);

  // Effect to reload logs when filters change
  useEffect(() => {
    if (!isLoading) {
      loadLogs();
    }
  }, [
    filterEventId,
    filterStatus,
    filterDate,
    filterEventOwnership,
    filterWorkflowId,
    currentPage,
    itemsPerPage,
  ]);

  const loadScripts = async () => {
    try {
      const scriptData = await fetchScripts();
      setScripts(scriptData);
    } catch (error) {
      console.error("Error loading scripts:", error);
    }
  };

  const loadWorkflows = async () => {
    if (!fetchWorkflows) return;
    try {
      const workflowData = await fetchWorkflows();
      setWorkflows(workflowData);
    } catch (error) {
      console.error("Error loading workflows:", error);
    }
  };

  const loadLogs = async () => {
    try {
      setIsLoading(true);

      // Build query string
      const queryParams = new URLSearchParams();
      queryParams.set("page", currentPage.toString());
      queryParams.set("pageSize", itemsPerPage.toString());

      // Only add params if they're not empty
      if (filterEventId && filterEventId !== "all")
        queryParams.set("eventId", filterEventId);
      if (filterStatus && filterStatus !== "all")
        queryParams.set("status", filterStatus);
      if (filterDate) queryParams.set("date", filterDate);
      if (filterWorkflowId && filterWorkflowId !== "all")
        queryParams.set("workflowId", filterWorkflowId);

      // Handle event ownership filtering
      if (filterEventOwnership === "own") {
        queryParams.set("ownEventsOnly", "true");
      } else if (filterEventOwnership === "shared") {
        queryParams.set("sharedOnly", "true");
      }

      const { logs, total } = await fetchLogs(queryParams);

      setLogs(logs);
      setTotalItems(total);
      setTotalPages(Math.ceil(total / itemsPerPage));
    } catch (error) {
      console.error("Error loading logs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadLogs();
    setIsRefreshing(false);
  };

  const handleFilterChange = (
    type: "script" | "status" | "date",
    value: string,
  ) => {
    // Update the appropriate filter state
    if (type === "script") setFilterEventId(value);
    if (type === "status") setFilterStatus(value);
    if (type === "date") setFilterDate(value);

    // Reset to first page when filters change
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilterEventId("");
    setFilterStatus("");
    setFilterDate("");
    setFilterEventOwnership("all");
    setFilterWorkflowId("");
    setCurrentPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  return (
    <div className={className}>
      <Card className="bg-secondary-bg mb-6">
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="w-full">
              <Label htmlFor="scriptFilter">Event</Label>
              <ComboBox
                options={[
                  { label: "All Events", value: "all" },
                  ...scripts.map((script) => ({
                    label: script.name,
                    value: script.id.toString(),
                  })),
                ]}
                value={filterEventId}
                onChange={(value) => handleFilterChange("script", value)}
                placeholder="All Events"
                maxDisplayItems={5}
                className="h-10"
              />
            </div>

            <div className="w-full">
              <Label htmlFor="statusFilter">Status</Label>
              <Select
                value={filterStatus}
                onValueChange={(value) => handleFilterChange("status", value)}
              >
                <SelectTrigger id="statusFilter" className="w-full">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value={LogStatus.SUCCESS}>Success</SelectItem>
                  <SelectItem value={LogStatus.FAILURE}>Failure</SelectItem>
                  <SelectItem value={LogStatus.RUNNING}>Running</SelectItem>
                  <SelectItem value={LogStatus.PAUSED}>Paused</SelectItem>
                  <SelectItem value={LogStatus.TIMEOUT}>Timeout</SelectItem>
                  <SelectItem value={LogStatus.PARTIAL}>Partial</SelectItem>
                  <SelectItem value={LogStatus.PENDING}>Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full">
              <Label htmlFor="dateFilter">Date</Label>
              <Input
                id="dateFilter"
                type="date"
                value={filterDate}
                onChange={(e) => handleFilterChange("date", e.target.value)}
                className="w-full hover:cursor-pointer disabled:pointer-events-none disabled:opacity-50"
              />
            </div>

            <div className="w-full">
              <Label htmlFor="ownershipFilter">Event Ownership</Label>
              <Select
                value={filterEventOwnership}
                onValueChange={(value) => {
                  setFilterEventOwnership(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="own">My Events</SelectItem>
                  <SelectItem value="shared">Shared with me</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full">
              <Label htmlFor="workflowFilter">Workflow</Label>
              <ComboBox
                options={[
                  { label: "All Workflows", value: "all" },
                  { label: "No Workflow", value: "none" },
                  ...workflows.map((workflow) => ({
                    label: workflow.name,
                    value: workflow.id.toString(),
                  })),
                ]}
                value={filterWorkflowId}
                onChange={(value) => {
                  setFilterWorkflowId(value);
                  setCurrentPage(1);
                }}
                placeholder="All Workflows"
                maxDisplayItems={5}
                className="h-10"
              />
            </div>

            <div className="w-full">
              <Label className="opacity-0">Actions</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="w-full"
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear Filters
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ActivityTable
        title={title}
        description={description ?? ""}
        data={logs}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        emptyStateMessage={
          filterEventId ||
          filterStatus ||
          filterDate ||
          filterEventOwnership !== "all" ||
          filterWorkflowId
            ? "No logs found with the current filters. Try clearing filters to see more results."
            : "No logs found"
        }
        showPagination={true}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        totalItems={totalItems}
        onPageSizeChange={handlePageSizeChange}
      />
    </div>
  );
}
