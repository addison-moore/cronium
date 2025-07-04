/**
 * Type-Safe Event Form Hook
 *
 * This hook provides a complete type-safe form management solution for event forms
 * using advanced TypeScript patterns for better developer experience and runtime safety.
 */

import { useReducer, useCallback, useMemo, useRef, useEffect } from "react";
import { EventType } from "@/shared/schema";
import type {
  EventFormData,
  EventFormErrors,
  EventFormTouched,
  UseEventFormOptions,
  UseEventFormReturn,
  EnvironmentVariableInput,
} from "./types";
import type { ConditionalAction } from "@/lib/advanced-types";
import {
  validateEventFormData,
  validateFormField,
  hasFormErrors,
  cleanEventFormData,
  assertEventHasRequiredFields,
} from "./guards";

// ===== FORM STATE =====

interface EventFormState<T extends EventType = EventType> {
  data: EventFormData<T>;
  errors: EventFormErrors;
  touched: EventFormTouched;
  isSubmitting: boolean;
  isDirty: boolean;
}

// ===== FORM ACTIONS =====

type EventFormAction<T extends EventType = EventType> =
  | { type: "SET_FIELD"; field: keyof EventFormData<T>; value: any }
  | { type: "SET_MULTIPLE_FIELDS"; fields: Partial<EventFormData<T>> }
  | { type: "SET_ERRORS"; errors: EventFormErrors }
  | {
      type: "SET_FIELD_ERROR";
      field: keyof EventFormErrors;
      error: string | undefined;
    }
  | { type: "SET_TOUCHED"; field: keyof EventFormTouched; touched: boolean }
  | { type: "SET_SUBMITTING"; submitting: boolean }
  | { type: "SET_DIRTY"; dirty: boolean }
  | { type: "RESET_FORM"; data?: Partial<EventFormData<T>> }
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

// ===== DEFAULT VALUES =====

function getDefaultEventFormData<T extends EventType>(
  eventType: T = EventType.PYTHON as T,
): EventFormData<T> {
  return {
    name: "",
    description: "",
    shared: false,
    status: "DRAFT" as const,
    tags: [],
    envVars: [],
    timeoutValue: 30,
    timeoutUnit: "SECONDS" as const,
    retries: 0,
    maxExecutions: 0,
    resetCounterOnActive: false,
    type: eventType,
    triggerType: "MANUAL" as const,
    runLocation: "LOCAL" as const,
    serverId: null,
    selectedServerIds: [] as any,
    conditionalActions: [],
    // Type-specific defaults will be set based on eventType
    ...(eventType === EventType.HTTP_REQUEST
      ? {
          httpMethod: "GET" as const,
          httpUrl: "",
          httpHeaders: [],
          httpBody: "",
        }
      : {
          content: "",
        }),
    ...(eventType !== EventType.HTTP_REQUEST ? {} : {}),
  } as EventFormData<T>;
}

function getDefaultTouched(): EventFormTouched {
  return {
    name: false,
    description: false,
    content: false,
    httpUrl: false,
    httpMethod: false,
    scheduleNumber: false,
    timeoutValue: false,
    retries: false,
    maxExecutions: false,
    customSchedule: false,
    envVars: {},
    conditionalActions: {},
  };
}

// ===== FORM REDUCER =====

function eventFormReducer<T extends EventType>(
  state: EventFormState<T>,
  action: EventFormAction<T>,
): EventFormState<T> {
  switch (action.type) {
    case "SET_FIELD":
      return {
        ...state,
        data: {
          ...state.data,
          [action.field]: action.value,
        },
        isDirty: true,
      };

    case "SET_MULTIPLE_FIELDS":
      return {
        ...state,
        data: {
          ...state.data,
          ...action.fields,
        },
        isDirty: true,
      };

    case "SET_ERRORS":
      return {
        ...state,
        errors: action.errors,
      };

    case "SET_FIELD_ERROR":
      return {
        ...state,
        errors: {
          ...state.errors,
          [action.field]: action.error,
        },
      };

    case "SET_TOUCHED":
      return {
        ...state,
        touched: {
          ...state.touched,
          [action.field]: action.touched,
        },
      };

    case "SET_SUBMITTING":
      return {
        ...state,
        isSubmitting: action.submitting,
      };

    case "SET_DIRTY":
      return {
        ...state,
        isDirty: action.dirty,
      };

    case "RESET_FORM":
      const defaultData = getDefaultEventFormData(state.data.type);
      return {
        data: action.data ? { ...defaultData, ...action.data } : defaultData,
        errors: {},
        touched: getDefaultTouched(),
        isSubmitting: false,
        isDirty: false,
      };

    case "ADD_ENV_VAR":
      return {
        ...state,
        data: {
          ...state.data,
          envVars: [
            ...state.data.envVars,
            { ...action.envVar, id: Date.now() },
          ],
        } as unknown as EventFormData<T>,
        isDirty: true,
      };

    case "REMOVE_ENV_VAR":
      return {
        ...state,
        data: {
          ...state.data,
          envVars: state.data.envVars.filter(
            (_, index) => index !== action.index,
          ),
        } as unknown as EventFormData<T>,
        isDirty: true,
      };

    case "UPDATE_ENV_VAR":
      return {
        ...state,
        data: {
          ...state.data,
          envVars: state.data.envVars.map((envVar, index) =>
            index === action.index ? { ...envVar, ...action.envVar } : envVar,
          ),
        } as unknown as EventFormData<T>,
        isDirty: true,
      };

    case "ADD_CONDITIONAL_ACTION":
      return {
        ...state,
        data: {
          ...state.data,
          conditionalActions: [...state.data.conditionalActions, action.action],
        },
        isDirty: true,
      };

    case "REMOVE_CONDITIONAL_ACTION":
      return {
        ...state,
        data: {
          ...state.data,
          conditionalActions: state.data.conditionalActions.filter(
            (_, index) => index !== action.index,
          ),
        },
        isDirty: true,
      };

    case "UPDATE_CONDITIONAL_ACTION":
      return {
        ...state,
        data: {
          ...state.data,
          conditionalActions: state.data.conditionalActions.map(
            (conditionalAction, index) =>
              index === action.index ? action.action : conditionalAction,
          ),
        },
        isDirty: true,
      };

    default:
      return state;
  }
}

// ===== MAIN HOOK =====

export function useEventForm<T extends EventType = EventType>(
  options: UseEventFormOptions<T> = {},
): UseEventFormReturn<T> {
  const { initialData, onSubmit, onValidate } = options;

  // Initialize form state
  const initialFormData = useMemo(() => {
    const defaultData = getDefaultEventFormData<T>(
      initialData?.type || (EventType.PYTHON as T),
    );
    return initialData ? { ...defaultData, ...initialData } : defaultData;
  }, [initialData]);

  const [state, dispatch] = useReducer(eventFormReducer<T>, {
    data: initialFormData,
    errors: {},
    touched: getDefaultTouched(),
    isSubmitting: false,
    isDirty: false,
  });

  // Store initial data for dirty checking
  const initialDataRef = useRef(initialFormData);

  // Update initial data when initialData prop changes
  useEffect(() => {
    if (initialData) {
      const newData = {
        ...getDefaultEventFormData(state.data.type),
        ...initialData,
      };
      initialDataRef.current = newData;
      dispatch({ type: "RESET_FORM", data: newData });
    }
  }, [initialData, state.data.type]);

  // ===== FIELD SETTERS =====

  const setField = useCallback(
    <K extends keyof EventFormData<T>>(
      field: K,
      value: EventFormData<T>[K],
    ) => {
      dispatch({ type: "SET_FIELD", field, value });

      // Validate field immediately if it's been touched
      if (state.touched[field as keyof EventFormTouched]) {
        const error = validateFormField(field, value, {
          ...state.data,
          [field]: value,
        });
        dispatch({
          type: "SET_FIELD_ERROR",
          field: field as keyof EventFormErrors,
          error: error || undefined,
        });
      }
    },
    [state.data, state.touched],
  );

  const setErrors = useCallback((errors: EventFormErrors) => {
    dispatch({ type: "SET_ERRORS", errors });
  }, []);

  const setTouched = useCallback(
    (field: keyof EventFormTouched, touched: boolean) => {
      dispatch({ type: "SET_TOUCHED", field, touched });

      // Validate field when it becomes touched
      if (touched) {
        const value = state.data[field as keyof EventFormData<T>];
        const error = validateFormField(
          field as keyof EventFormData<T>,
          value,
          state.data,
        );
        dispatch({
          type: "SET_FIELD_ERROR",
          field: field as keyof EventFormErrors,
          error: error || undefined,
        });
      }
    },
    [state.data],
  );

  // ===== ARRAY FIELD HELPERS =====

  const addEnvVar = useCallback((envVar: EnvironmentVariableInput) => {
    dispatch({ type: "ADD_ENV_VAR", envVar });
  }, []);

  const removeEnvVar = useCallback((index: number) => {
    dispatch({ type: "REMOVE_ENV_VAR", index });
  }, []);

  const updateEnvVar = useCallback(
    (index: number, envVar: EnvironmentVariableInput) => {
      dispatch({ type: "UPDATE_ENV_VAR", index, envVar });
    },
    [],
  );

  const addConditionalAction = useCallback((action: ConditionalAction) => {
    dispatch({ type: "ADD_CONDITIONAL_ACTION", action });
  }, []);

  const removeConditionalAction = useCallback((index: number) => {
    dispatch({ type: "REMOVE_CONDITIONAL_ACTION", index });
  }, []);

  const updateConditionalAction = useCallback(
    (index: number, action: ConditionalAction) => {
      dispatch({ type: "UPDATE_CONDITIONAL_ACTION", index, action });
    },
    [],
  );

  // ===== VALIDATION =====

  const validateField = useCallback(
    (field: keyof EventFormData<T>) => {
      const value = state.data[field];
      return validateFormField(field, value, state.data);
    },
    [state.data],
  );

  const validateForm = useCallback(() => {
    const errors = onValidate
      ? onValidate(state.data)
      : validateEventFormData(state.data);
    if (errors) {
      dispatch({ type: "SET_ERRORS", errors });
      return false;
    }
    dispatch({ type: "SET_ERRORS", errors: {} });
    return true;
  }, [state.data, onValidate]);

  // ===== FORM ACTIONS =====

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
      }

      dispatch({ type: "SET_SUBMITTING", submitting: true });

      try {
        // Validate form
        if (!validateForm()) {
          return;
        }

        // Assert required fields are present
        assertEventHasRequiredFields(state.data, state.data.type);

        // Clean data for submission
        const cleanedData = cleanEventFormData(state.data);

        // Call onSubmit if provided
        if (onSubmit) {
          await onSubmit(cleanedData);
        }

        // Mark as not dirty after successful submission
        dispatch({ type: "SET_DIRTY", dirty: false });
      } catch (error) {
        if (error instanceof Error) {
          dispatch({
            type: "SET_FIELD_ERROR",
            field: "name", // Default field for general errors
            error: error.message,
          });
        }
      } finally {
        dispatch({ type: "SET_SUBMITTING", submitting: false });
      }
    },
    [state.data, validateForm, onSubmit],
  );

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET_FORM", data: initialDataRef.current });
  }, []);

  // ===== COMPUTED VALUES =====

  const isValid = useMemo(() => {
    return !hasFormErrors(state.errors);
  }, [state.errors]);

  const isDirty = useMemo(() => {
    return state.isDirty;
  }, [state.isDirty]);

  // ===== RETURN HOOK INTERFACE =====

  return {
    // Form data
    data: state.data,
    errors: state.errors,
    touched: state.touched,
    isSubmitting: state.isSubmitting,
    isValid,
    isDirty,

    // Field setters
    setField,
    setErrors,
    setTouched,

    // Array field helpers
    addEnvVar,
    removeEnvVar,
    updateEnvVar,
    addConditionalAction,
    removeConditionalAction,
    updateConditionalAction,

    // Form actions
    handleSubmit,
    handleReset,
    validateField,
    validateForm,
  };
}

// ===== EXPORT UTILITIES =====

export type { UseEventFormOptions, UseEventFormReturn } from "./types";
export { getDefaultEventFormData, getDefaultTouched };
