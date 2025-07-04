import { type EventType, type TimeUnit, type EventStatus, type RunLocation, type ConditionalActionType, type UserRole } from "@shared/schema";
import { type IconType } from "react-icons";

// Extend NextAuth types
import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    role: UserRole;
  }

  interface Session {
    user: User & {
      id: string;
      role: UserRole;
    };
  }
}

// App types
export interface NavItem {
  title: string;
  href: string;
  icon: IconType;
  submenu?: NavItem[];
  role?: UserRole;
}

export interface EnvVarInput {
  key: string;
  value: string;
}

export interface EventInput {
  type: ConditionalActionType;
  value?: string;
  targetScriptId?: string;
}

export interface CreateScriptInput {
  name: string;
  type: EventType;
  content: string;
  status: EventStatus;
  scheduleNumber: number;
  scheduleUnit: TimeUnit;
  customSchedule?: string;
  runLocation: RunLocation;
  serverId?: string;
  timeoutValue: number;
  timeoutUnit: TimeUnit;
  retries: number;
  envVars: EnvVarInput[];
  onSuccessActions: EventInput[];
  onFailActions: EventInput[];
}

export interface UpdateScriptInput extends CreateScriptInput {
  id: string;
}

export interface CreateServerInput {
  name: string;
  address: string;
  sshKey: string;
}

export interface UpdateUserInput {
  id: string;
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  gitHubAccessToken?: string;
}

export interface UpdateSettingsInput {
  smtpServer?: string;
  smtpPort?: number;
  smtpFromAddress?: string;
  smtpUser?: string;
  smtpPassword?: string;
  openRegistration?: boolean;
  webhookUrl?: string;
}

// Utility Types for Type Safety
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type SafeAny = never; // Use this instead of 'any'

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = unknown> {
  items: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface ErrorResponse {
  error: string;
  message?: string;
  statusCode?: number;
  timestamp?: string;
}

// Database Entity Base
export interface DatabaseEntity {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

// Form Types
export interface FormState<T = unknown> {
  data: T;
  errors: Record<string, string>;
  isSubmitting: boolean;
  isDirty: boolean;
}

// Event Handler Types (replace any event handlers)
export interface CustomEventHandler<T = HTMLElement> {
  (event: React.SyntheticEvent<T>): void;
}

export interface FormEventHandler<T = HTMLFormElement> {
  (event: React.FormEvent<T>): void;
}

export interface ChangeEventHandler<T = HTMLInputElement> {
  (event: React.ChangeEvent<T>): void;
}

// Loading State Types
export type LoadingState<T, E = Error> = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: E };

// Tool Integration Types
export interface ToolCredentials {
  id: number;
  name: string;
  type: string;
  credentials: Record<string, unknown>;
  isActive: boolean;
}

export interface MessageTemplate {
  id: number;
  name: string;
  type: string;
  content: string;
  subject?: string;
  isSystemTemplate: boolean;
}
