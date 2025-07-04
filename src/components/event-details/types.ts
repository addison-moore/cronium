import { type EventStatus, type EventType } from "@/shared/schema";

export interface Log {
  id: number;
  scriptId?: number;
  eventId?: number;
  status: string;
  output: string | null;
  error: string | null;
  userId?: string | null;
  startTime: string | Date;
  endTime?: string | Date | null;
  duration: number | null;
  retries?: number | null;
  scriptType?: EventType | null;
}

export interface Event {
  id: number;
  name: string;
  type: EventType;
  status: EventStatus;
  content: string | null;
  scheduleNumber: number;
  scheduleUnit: string;
  customSchedule: string | null;
  runLocation: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  successCount: number;
  executionCount: number;
  maxExecutions: number;
  resetCounterOnActive: boolean | string;
  failureCount: number;
  timeoutValue: number;
  timeoutUnit: string;
  retries: number;
  tags?: string[];
  environmentVariables: { key: string; value: string }[];
  events: {
    type: string;
    details: any;
  }[];
  httpRequest?: {
    method: string;
    url: string;
    headers: { key: string; value: string }[];
    body: string | null;
  } | null;
  successEvents: any[];
  failEvents: any[];
  alwaysEvents: any[];
  conditionEvents: any[];
  servers?: {
    id: number;
    name: string;
    address: string;
    port: number;
  }[];
  description?: string;
  active?: boolean;
  schedule?: string;
  conditionalActions?: Array<{
    type: string;
    action: string;
    description?: string;
  }>;
}

export interface EventDetailsProps {
  event: Event;
  langParam: string;
  onDelete?: () => void;
  onRun?: () => void;
  onToggleStatus?: () => void;
  onResetCounter?: () => void;
  isRunning?: boolean;
  isResettingCounter?: boolean;
}
