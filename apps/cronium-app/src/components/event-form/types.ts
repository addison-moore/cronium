/**
 * Advanced Type-Safe Event Form Types
 *
 * This file contains sophisticated type definitions for the EventForm component
 * that provide complete type safety and better developer experience.
 */

import type {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
} from "@/shared/schema";

import type {
  ConditionalAction,
  ScheduleConfig,
  EventId,
  ServerId,
  ToolId,
  EventTypeConfig,
  PartialBy,
} from "@/lib/advanced-types";

// ===== EDITOR CONFIGURATION =====

export interface EditorSettings {
  fontSize: number;
  theme: "vs-dark" | "vs-light" | "hc-black";
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
}

// ===== ENVIRONMENT VARIABLES =====

export interface EnvironmentVariable {
  id?: number;
  key: string;
  value: string;
  isSecret?: boolean;
}

export type EnvironmentVariableInput = PartialBy<EnvironmentVariable, "id">;

// ===== HTTP REQUEST CONFIGURATION =====

export interface HttpRequestConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  url: string;
  headers: Array<{
    key: string;
    value: string;
    enabled: boolean;
  }>;
  body: string;
  timeout?: number;
  followRedirects?: boolean;
  validateSSL?: boolean;
}

// ===== EVENT FORM DATA =====

export interface BaseEventData {
  id?: EventId;
  name: string;
  description?: string;
  shared: boolean;
  status: EventStatus;
  tags: string[];
  envVars: EnvironmentVariable[];
  timeoutValue: number;
  timeoutUnit: TimeUnit;
  retries: number;
  maxExecutions: number;
  resetCounterOnActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Type-safe event data based on event type and trigger type
 */
export type EventFormData<
  T extends EventType = EventType,
  S extends EventTriggerType = EventTriggerType,
  R extends RunLocation = RunLocation,
> = BaseEventData &
  EventTypeConfig<T> &
  ScheduleConfig<S> & {
    type: T;
    triggerType: S;
    runLocation: R;
    serverId: R extends RunLocation.REMOTE ? ServerId : null;
    selectedServerIds: R extends RunLocation.REMOTE ? ServerId[] : never;
    conditionalActions: ConditionalAction[];
  };

// ===== FORM PROPS =====

export interface EventFormProps<T extends EventType = EventType> {
  initialData?: Partial<EventFormData<T>>;
  isEditing?: boolean;
  eventId?: EventId;
  onSuccess?: (eventId: EventId) => void;
  onCancel?: () => void;
  className?: string;
}

// ===== FORM STATE MANAGEMENT =====

export interface EventFormErrors {
  name?: string;
  description?: string;
  content?: string;
  httpUrl?: string;
  httpMethod?: string;
  scheduleNumber?: string;
  timeoutValue?: string;
  retries?: string;
  maxExecutions?: string;
  customSchedule?: string;
  envVars?: Record<number, string>;
  conditionalActions?: Record<number, string>;
}

export interface EventFormTouched {
  name: boolean;
  description: boolean;
  content: boolean;
  httpUrl: boolean;
  httpMethod: boolean;
  scheduleNumber: boolean;
  timeoutValue: boolean;
  retries: boolean;
  maxExecutions: boolean;
  customSchedule: boolean;
  envVars: Record<number, boolean>;
  conditionalActions: Record<number, boolean>;
}

// ===== VALIDATION SCHEMAS =====

export interface ValidationRule<T = unknown> {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  min?: number;
  max?: number;
  custom?: (value: T) => string | null;
}

export type ValidationSchema<T extends Record<string, unknown>> = {
  [K in keyof T]?: ValidationRule<T[K]>;
};

// ===== FORM ACTIONS =====

export type EventFormAction =
  | { type: "SET_FIELD"; field: string; value: unknown }
  | { type: "SET_ERRORS"; errors: EventFormErrors }
  | { type: "SET_TOUCHED"; field: string; touched: boolean }
  | { type: "SET_SUBMITTING"; submitting: boolean }
  | { type: "RESET_FORM"; data?: Partial<EventFormData> }
  | { type: "ADD_ENV_VAR"; envVar: EnvironmentVariableInput }
  | { type: "REMOVE_ENV_VAR"; index: number }
  | { type: "UPDATE_ENV_VAR"; index: number; envVar: EnvironmentVariableInput }
  | { type: "ADD_CONDITIONAL_ACTION"; action: ConditionalAction }
  | { type: "REMOVE_CONDITIONAL_ACTION"; index: number }
  | {
      type: "UPDATE_CONDITIONAL_ACTION";
      index: number;
      action: ConditionalAction;
    };

// ===== FORM HOOKS =====

export interface UseEventFormOptions<T extends EventType = EventType> {
  initialData?: Partial<EventFormData<T>>;
  validationSchema?: ValidationSchema<EventFormData<T>>;
  onSubmit?: (data: EventFormData<T>) => Promise<void> | void;
  onValidate?: (data: EventFormData<T>) => EventFormErrors | null;
}

export interface UseEventFormReturn<T extends EventType = EventType> {
  // Form data
  data: EventFormData<T>;
  errors: EventFormErrors;
  touched: EventFormTouched;
  isSubmitting: boolean;
  isValid: boolean;
  isDirty: boolean;

  // Field setters
  setField: <K extends keyof EventFormData<T>>(
    field: K,
    value: EventFormData<T>[K],
  ) => void;
  setErrors: (errors: EventFormErrors) => void;
  setTouched: (field: keyof EventFormTouched, touched: boolean) => void;

  // Array field helpers
  addEnvVar: (envVar: EnvironmentVariableInput) => void;
  removeEnvVar: (index: number) => void;
  updateEnvVar: (index: number, envVar: EnvironmentVariableInput) => void;

  addConditionalAction: (action: ConditionalAction) => void;
  removeConditionalAction: (index: number) => void;
  updateConditionalAction: (index: number, action: ConditionalAction) => void;

  // Form actions
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  handleReset: () => void;
  validateField: (field: keyof EventFormData<T>) => string | null;
  validateForm: () => boolean;
}

// ===== COMPONENT PROPS =====

export interface EventFormSectionProps {
  className?: string;
  children?: React.ReactNode;
}

export interface EventTypeSelectProps {
  value: EventType;
  onChange: (type: EventType) => void;
  disabled?: boolean;
  className?: string;
}

export interface ScheduleConfigProps<
  T extends EventTriggerType = EventTriggerType,
> {
  triggerType: T;
  scheduleConfig: ScheduleConfig<T>;
  onChange: (config: ScheduleConfig<T>) => void;
  errors?: Pick<EventFormErrors, "scheduleNumber" | "customSchedule">;
  className?: string;
}

export interface HttpRequestConfigProps {
  config: HttpRequestConfig;
  onChange: (config: HttpRequestConfig) => void;
  errors?: Pick<EventFormErrors, "httpUrl" | "httpMethod">;
  className?: string;
}

export interface EnvVarsConfigProps {
  envVars: EnvironmentVariable[];
  onChange: (envVars: EnvironmentVariable[]) => void;
  errors?: Record<number, string>;
  className?: string;
}

// ===== CONDITIONAL ACTIONS =====

export interface ConditionalActionsProps {
  actions: ConditionalAction[];
  availableEvents: Array<{ id: EventId; name: string; type: EventType }>;
  availableTools: Array<{ id: ToolId; name: string; type: string }>;
  onChange: (actions: ConditionalAction[]) => void;
  errors?: Record<number, string>;
  className?: string;
}

// ===== SERVER SELECTION =====

export interface ServerSelectionProps {
  runLocation: RunLocation;
  serverId: ServerId | null;
  selectedServerIds: ServerId[];
  availableServers: Array<{
    id: ServerId;
    name: string;
    address: string;
    online: boolean;
  }>;
  onChange: (config: {
    runLocation: RunLocation;
    serverId: ServerId | null;
    selectedServerIds: ServerId[];
  }) => void;
  className?: string;
}

// ===== FORM UTILITIES =====

export type EventFormField = keyof EventFormData;

export type EventFormFieldValue<K extends EventFormField> = EventFormData[K];

export type EventFormValidator<T extends EventType = EventType> = (
  data: EventFormData<T>,
) => EventFormErrors | null;

export type EventFormSubmitter<T extends EventType = EventType> = (
  data: EventFormData<T>,
) => Promise<
  { success: true; data: EventFormData<T> } | { success: false; error: string }
>;

// ===== EXPORT TYPES FOR EXTERNAL USE =====

export type {
  EventConfig,
  ConditionalAction,
  ScheduleConfig,
  EventFormState,
  FormFieldState,
  EventId,
  ServerId,
  ToolId,
} from "@/lib/advanced-types";
