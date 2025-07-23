/**
 * Examples of using the enhanced tRPC configuration and utilities.
 * This file demonstrates best practices for common patterns.
 */

import {
  type RouterInputs,
  type RouterOutputs,
  QUERY_OPTIONS,
  getFieldError,
  isTRPCError,
} from "./shared";

// Example: Type-safe input/output types
type CreateEventInput = RouterInputs["events"]["create"];
type EventOutput = RouterOutputs["events"]["getById"];

// Example: Using query options for different data types
export const useEventQueries = () => {
  // For real-time data (monitoring, logs)
  const realtimeOptions = QUERY_OPTIONS.realtime;

  // For user-interactive data (events, workflows)
  const dynamicOptions = QUERY_OPTIONS.dynamic;

  // For configuration data (settings, servers)
  const staticOptions = QUERY_OPTIONS.static;

  // For reference data (user roles, permissions)
  const stableOptions = QUERY_OPTIONS.stable;

  return { realtimeOptions, dynamicOptions, staticOptions, stableOptions };
};

// Example: Error handling with type safety
export const handleEventCreation = async (input: CreateEventInput) => {
  try {
    // In a real component, this would be a mutation
    console.log("Creating event with input:", input);
  } catch (error) {
    if (isTRPCError(error)) {
      // Handle specific tRPC errors
      switch (error.data?.code) {
        case "UNAUTHORIZED":
          console.error("User not authenticated");
          break;
        case "FORBIDDEN":
          console.error("User lacks permission");
          break;
        case "BAD_REQUEST":
          // Handle validation errors
          const nameError = getFieldError(error, "name");
          const scriptError = getFieldError(error, "script");

          if (nameError) console.error("Name error:", nameError);
          if (scriptError) console.error("Script error:", scriptError);
          break;
        default:
          console.error("Unexpected error:", error.message);
      }
    } else {
      console.error("Non-tRPC error:", error);
    }
  }
};

// Example: Component usage patterns
export const exampleComponentPatterns = {
  // Static data that rarely changes
  userRoles: {
    queryOptions: QUERY_OPTIONS.stable,
    description: "User roles and permissions (changes rarely)",
  },

  // Dynamic user data
  userEvents: {
    queryOptions: QUERY_OPTIONS.dynamic,
    description: "User's events and workflows (moderate changes)",
  },

  // Real-time monitoring data
  serverMetrics: {
    queryOptions: QUERY_OPTIONS.realtime,
    description: "Server monitoring and metrics (frequent updates)",
  },

  // Configuration settings
  systemSettings: {
    queryOptions: QUERY_OPTIONS.static,
    description: "System configuration (infrequent changes)",
  },
};

// Example: Optimistic update pattern
export const optimisticUpdateExample = {
  // Before mutation
  onMutate: async (_newData: Partial<EventOutput>) => {
    // Cancel outgoing refetches
    // await utils.events.getById.cancel({ id: newData.id });
    // Snapshot previous value
    // const previousEvent = utils.events.getById.getData({ id: newData.id });
    // Optimistically update
    // utils.events.getById.setData({ id: newData.id }, (old) => ({ ...old, ...newData }));
    // Return rollback data
    // return { previousEvent };
  },

  // On error, rollback
  onError: (
    _err: unknown,
    _newData: Partial<EventOutput>,
    _context: unknown,
  ) => {
    // utils.events.getById.setData({ id: newData.id }, context?.previousEvent);
  },

  // Always refetch after error or success
  onSettled: () => {
    // utils.events.getById.invalidate();
  },
};
