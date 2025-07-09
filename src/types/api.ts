/**
 * API Response Types for Type Safety
 *
 * This file contains all API response interfaces to replace 'any' types
 * throughout the application.
 */

import type {
  Event,
  Log,
  Server,
  User,
  ConditionalAction,
  Workflow,
  UserVariable,
  Tool,
} from "@shared/schema";
import type { ApiResponse, PaginatedResponse, ErrorResponse } from "./index";

// Generic API Response Types
export interface SuccessResponse {
  success: true;
}

export interface ErrorApiResponse extends ErrorResponse {
  success: false;
}

// Event API Types
export interface EventsResponse extends PaginatedResponse<Event> {
  events: Event[];
}

export interface EventResponse extends ApiResponse<Event> {
  event?: Event;
}

export interface EventExecutionResponse extends ApiResponse {
  logId: number;
}

// Log API Types
export interface LogsResponse extends PaginatedResponse<Log> {
  logs: Log[];
}

export interface LogResponse extends ApiResponse<Log> {
  log?: Log;
}

// Server API Types
export interface ServersResponse extends PaginatedResponse<Server> {
  servers: Server[];
}

export interface ServerResponse extends ApiResponse<Server> {
  server?: Server;
}

export interface ServerStatusResponse extends ApiResponse {
  online: boolean;
  lastChecked: string;
}

// User API Types
export interface UsersResponse extends PaginatedResponse<User> {
  users: User[];
}

export interface UserResponse extends ApiResponse<User> {
  user?: User;
}

export interface AuthResponse extends ApiResponse {
  token?: string;
  redirectUrl?: string;
}

// Workflow API Types
export interface WorkflowsResponse extends PaginatedResponse<Workflow> {
  workflows: Workflow[];
}

export interface WorkflowResponse extends ApiResponse<Workflow> {
  workflow?: Workflow;
}

export interface WorkflowExecutionResponse extends ApiResponse {
  executionId: number;
}

// Variables API Types
export interface VariablesResponse extends PaginatedResponse<UserVariable> {
  variables: UserVariable[];
}

export interface VariableResponse extends ApiResponse<UserVariable> {
  variable?: UserVariable;
}

// Tool API Types
export interface ToolsResponse extends PaginatedResponse<Tool> {
  tools: Tool[];
}

export interface ToolResponse extends ApiResponse<Tool> {
  tool?: Tool;
}

export interface ToolTestResponse extends ApiResponse {
  testResult: {
    success: boolean;
    message: string;
    responseTime?: number;
  };
}


// Conditional Events API Types
export interface ConditionalEventsResponse
  extends PaginatedResponse<ConditionalAction> {
  conditionalEvents: ConditionalAction[];
}

export interface ConditionalEventResponse
  extends ApiResponse<ConditionalAction> {
  conditionalEvent?: ConditionalAction;
}

// Dashboard API Types
export interface DashboardStatsResponse extends ApiResponse {
  stats: {
    totalScripts: number;
    activeScripts: number;
    eventsCount: number;
    workflowsCount: number;
    serversCount: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    recentActivity: Array<{
      id: number;
      type: "event" | "workflow";
      name: string;
      status: string;
      timestamp: string;
    }>;
  };
}

// Settings API Types
export interface SystemSettingsResponse extends ApiResponse {
  settings: {
    smtpEnabled: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpFromEmail?: string;
    smtpFromName?: string;
    allowRegistration: boolean;
    requireAdminApproval: boolean;
    aiEnabled: boolean;
    aiModel?: string;
    openaiApiKey?: string;
  };
}

// File Download API Types
export interface DownloadResponse extends ApiResponse {
  format: string;
  filename: string;
  data: string; // Base64 encoded or direct content
}

// Monitoring API Types
export interface MonitoringResponse extends ApiResponse {
  monitoring: {
    systemHealth: {
      cpu: number;
      memory: number;
      disk: number;
      uptime: number;
    };
    activeConnections: number;
    scheduledEvents: number;
    queuedTasks: number;
  };
}

// Third-party Integration Types
export interface SlackApiResponse {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface DiscordApiResponse {
  id?: string;
  channel_id?: string;
  content?: string;
  timestamp?: string;
  error?: {
    code: number;
    message: string;
  };
}

export interface EmailApiResponse {
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  error?: string;
}

// Generic tRPC Response Wrapper
export interface TRPCResponse<T = unknown> {
  result:
    | {
        type: "data";
        data: T;
      }
    | {
        type: "error";
        error: {
          message: string;
          code: number;
          data?: {
            code: string;
            httpStatus?: number;
            stack?: string;
            path: string;
          };
        };
      };
}

// Helper type for extracting data from tRPC responses
export type ExtractTRPCData<T> = T extends TRPCResponse<infer U> ? U : never;

// Union type for all possible API responses
export type AnyApiResponse =
  | EventsResponse
  | EventResponse
  | LogsResponse
  | ServersResponse
  | UsersResponse
  | WorkflowsResponse
  | VariablesResponse
  | ToolsResponse
  | TemplatesResponse
  | DashboardStatsResponse
  | SystemSettingsResponse
  | ErrorApiResponse;
