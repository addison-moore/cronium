import { type EventStatus, type EventType } from "@/shared/schema";

export interface Event {
  id: number;
  name: string;
  description: string | null;
  shared?: boolean;
  type: EventType;
  status: EventStatus;
  content: string | null;
  scheduleNumber: number;
  scheduleUnit: string;
  customSchedule: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  successCount?: number;
  failureCount?: number;
  tags?: string[];
  // HTTP Request specific fields
  httpMethod?: string;
  httpUrl?: string;
  httpHeaders?: Array<{ key: string; value: string }>;
  httpBody?: string;
  // Server related fields
  runLocation?: string;
  serverId?: number | null;
  eventServers?: number[]; // Array of server IDs for multi-server events
  // Additional fields
  timeoutValue?: number;
  timeoutUnit?: string;
  retries?: number;
  gistId?: string | null;
  gistFileName?: string | null;
  // Workflow related fields
  workflowId?: number | null;
}

export interface ServerData {
  id: number;
  name: string;
  address: string;
  username: string;
  port: number;
}

export interface WorkflowData {
  id: number;
  name: string;
  description?: string;
  eventIds: number[];
}

export interface EventListFilters {
  searchTerm: string;
  typeFilter: string;
  statusFilter: string;
  serverFilter: string;
  tagFilter: string;
  workflowFilter: string;
  sortBy: "name" | "createdAt" | "lastRunAt";
  sortOrder: "asc" | "desc";
}

export interface EventListState {
  currentPage: number;
  itemsPerPage: number;
  selectedEvents: Set<number>;
  bulkActionLoading: string | null;
  isRunning: Record<number, boolean>;
}
