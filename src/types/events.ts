/**
 * DOM and Custom Event Types for Type Safety
 *
 * This file provides type-safe alternatives to 'any' event handlers
 * throughout the React application.
 */

import type {
  SyntheticEvent,
  FormEvent,
  ChangeEvent,
  MouseEvent,
  KeyboardEvent,
  FocusEvent,
} from "react";

// Generic Event Handler Types
export type EventHandler<T = HTMLElement> = (event: SyntheticEvent<T>) => void;
export type VoidEventHandler = () => void;

// Form Event Types
export type FormSubmitHandler<T = HTMLFormElement> = (
  event: FormEvent<T>,
) => void;
export type FormChangeHandler<T = HTMLInputElement> = (
  event: ChangeEvent<T>,
) => void;
export type FormFocusHandler<T = HTMLInputElement> = (
  event: FocusEvent<T>,
) => void;

// Input-specific Event Types
export type InputChangeHandler = (event: ChangeEvent<HTMLInputElement>) => void;
export type TextareaChangeHandler = (
  event: ChangeEvent<HTMLTextAreaElement>,
) => void;
export type SelectChangeHandler = (
  event: ChangeEvent<HTMLSelectElement>,
) => void;

// Value-based Event Handlers (for controlled components)
export type ValueChangeHandler<T = string> = (value: T) => void;
export type StringChangeHandler = ValueChangeHandler<string>;
export type NumberChangeHandler = ValueChangeHandler<number>;
export type BooleanChangeHandler = ValueChangeHandler<boolean>;
export type DateChangeHandler = ValueChangeHandler<Date>;

// Mouse Event Types
export type ClickHandler<T = HTMLElement> = (event: MouseEvent<T>) => void;
export type ButtonClickHandler = ClickHandler<HTMLButtonElement>;
export type DivClickHandler = ClickHandler<HTMLDivElement>;

// Keyboard Event Types
export type KeyPressHandler<T = HTMLElement> = (
  event: KeyboardEvent<T>,
) => void;
export type KeyDownHandler<T = HTMLElement> = (event: KeyboardEvent<T>) => void;
export type KeyUpHandler<T = HTMLElement> = (event: KeyboardEvent<T>) => void;

// Custom Application Event Types
export interface CustomApplicationEvent<T = unknown> {
  type: string;
  data: T;
  timestamp: Date;
  source?: string;
}

// Event System Types for Event Execution
export interface EventExecutionData {
  eventId: number;
  logId: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  output?: string;
  error?: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILURE" | "TIMEOUT";
}

export interface WorkflowExecutionData {
  workflowId: number;
  executionId: number;
  currentStep: number;
  totalSteps: number;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";
  events: EventExecutionData[];
}

// WebSocket Event Types
export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: string;
  id?: string;
}

export interface TerminalMessage extends WebSocketMessage {
  type: "terminal_output" | "terminal_input" | "terminal_resize";
  payload: {
    data?: string;
    cols?: number;
    rows?: number;
    sessionId: string;
  };
}

export interface LogStreamMessage extends WebSocketMessage {
  type: "log_update" | "log_complete";
  payload: {
    logId: number;
    eventId: number;
    status: string;
    output?: string;
    error?: string;
    duration?: number;
  };
}

// Modal and Dialog Event Types
export interface ModalEventHandlers {
  onOpen?: VoidEventHandler;
  onClose?: VoidEventHandler;
  onConfirm?: VoidEventHandler;
  onCancel?: VoidEventHandler;
}

export interface DialogEventHandlers extends ModalEventHandlers {
  onSubmit?: FormSubmitHandler;
}

// Table and List Event Types
export interface TableEventHandlers<T = unknown> {
  onRowClick?: (item: T, index: number) => void;
  onRowSelect?: (items: T[]) => void;
  onSort?: (column: string, direction: "asc" | "desc") => void;
  onFilter?: (filters: Record<string, unknown>) => void;
  onPageChange?: (page: number) => void;
}

export interface ListEventHandlers<T = unknown> {
  onItemClick?: (item: T, index: number) => void;
  onItemSelect?: (item: T, selected: boolean) => void;
  onItemsSelect?: (items: T[]) => void;
  onItemsReorder?: (items: T[]) => void;
}

// Form Field Event Types for Complex Components
export interface FieldEventHandlers<T = string> {
  onChange?: ValueChangeHandler<T>;
  onBlur?: FormFocusHandler;
  onFocus?: FormFocusHandler;
  onValidate?: (value: T) => string | undefined;
  onClear?: VoidEventHandler;
}

export interface FileInputEventHandlers {
  onFileSelect?: (files: FileList) => void;
  onFilesDrop?: (files: FileList) => void;
  onFileRemove?: (index: number) => void;
  onUploadProgress?: (progress: number) => void;
  onUploadComplete?: (urls: string[]) => void;
  onUploadError?: (error: string) => void;
}

// Date and Time Picker Event Types
export interface DatePickerEventHandlers {
  onDateSelect?: DateChangeHandler;
  onDateClear?: VoidEventHandler;
  onMonthChange?: (month: number, year: number) => void;
  onYearChange?: (year: number) => void;
}

export interface TimePickerEventHandlers {
  onTimeSelect?: (time: {
    hours: number;
    minutes: number;
    seconds?: number;
  }) => void;
  onTimeClear?: VoidEventHandler;
}

// Search and Filter Event Types
export interface SearchEventHandlers {
  onSearch?: StringChangeHandler;
  onSearchClear?: VoidEventHandler;
  onSearchSubmit?: (query: string) => void;
  onFilterChange?: (filters: Record<string, unknown>) => void;
  onSortChange?: (field: string, direction: "asc" | "desc") => void;
}

// Navigation Event Types
export interface NavigationEventHandlers {
  onNavigate?: (path: string) => void;
  onBack?: VoidEventHandler;
  onForward?: VoidEventHandler;
  onHome?: VoidEventHandler;
  onRefresh?: VoidEventHandler;
}

// Drag and Drop Event Types
export interface DragDropEventHandlers<T = unknown> {
  onDragStart?: (item: T, event: React.DragEvent) => void;
  onDragEnd?: (item: T, event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (item: T, target: T, event: React.DragEvent) => void;
  onReorder?: (items: T[]) => void;
}

// Animation and Transition Event Types
export interface AnimationEventHandlers {
  onAnimationStart?: (event: React.AnimationEvent) => void;
  onAnimationEnd?: (event: React.AnimationEvent) => void;
  onTransitionStart?: (event: React.TransitionEvent) => void;
  onTransitionEnd?: (event: React.TransitionEvent) => void;
}

// Utility Types for Event Handler Composition
export type OptionalEventHandlers<T> = {
  [K in keyof T]?: T[K];
};

export type RequiredEventHandlers<T, K extends keyof T> = T &
  Required<Pick<T, K>>;

// Event Handler Guards (Type Guards)
export const isFormEvent = (event: SyntheticEvent): event is FormEvent => {
  return event.type === "submit" || event.type === "reset";
};

export const isChangeEvent = (event: SyntheticEvent): event is ChangeEvent => {
  return event.type === "change";
};

export const isClickEvent = (event: SyntheticEvent): event is MouseEvent => {
  return event.type === "click" || event.type === "dblclick";
};

export const isKeyboardEvent = (
  event: SyntheticEvent,
): event is KeyboardEvent => {
  return event.type.startsWith("key");
};

// Event Factory Functions for Type Safety
export const createEventHandler = <T extends HTMLElement>(
  handler: (event: SyntheticEvent<T>) => void,
): EventHandler<T> => handler;

export const createFormHandler = <T extends HTMLFormElement>(
  handler: (event: FormEvent<T>) => void,
): FormSubmitHandler<T> => handler;

export const createChangeHandler = <T extends HTMLInputElement>(
  handler: (event: ChangeEvent<T>) => void,
): FormChangeHandler<T> => handler;

export const createValueHandler = <T>(
  handler: (value: T) => void,
): ValueChangeHandler<T> => handler;
