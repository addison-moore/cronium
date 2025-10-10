import { type z } from "zod";
import { ToolPluginRegistry } from "@/tools/plugins";

// Log plugin initialization status
console.log("[ServerActionExecutor] Initializing - checking plugin registry");
console.log(
  "[ServerActionExecutor] Actions registered:",
  ToolPluginRegistry.getAllActions().length,
);
console.log(
  "[ServerActionExecutor] Action IDs:",
  ToolPluginRegistry.getAllActions().map((a) => a.id),
);

// Re-define the execution context type to avoid circular dependency
export interface ToolActionExecutionContext {
  variables: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
  onProgress?: (progress: { step: string; percentage: number }) => void;
  onPartialResult?: (result: unknown) => void;
  isTest?: boolean;
  mockData?: unknown;
}

// No hardcoded schemas or executors needed - using plugin registry

// Server-side action definition type
interface ServerActionDefinition {
  id: string;
  name: string;
  actionType: string;
  inputSchema: z.ZodSchema;
  features?: {
    webhookSupport?: boolean;
  };
  execute: (
    credentials: Record<string, unknown>,
    parameters: Record<string, unknown>,
    context: ToolActionExecutionContext,
  ) => Promise<unknown>;
}

/**
 * Get server-side action definition by ID from the plugin registry
 */
export function getServerActionById(
  actionId: string,
): ServerActionDefinition | null {
  // Get action from plugin registry
  const action = ToolPluginRegistry.getActionById(actionId);

  if (!action) {
    return null;
  }

  // Return action definition compatible with server-side execution
  const definition: ServerActionDefinition = {
    id: action.id,
    name: action.name,
    actionType: action.actionType,
    inputSchema: action.inputSchema,
    execute: action.execute,
  };

  if (action.features) {
    definition.features = action.features;
  }

  return definition;
}

/**
 * Get all available server action IDs from the plugin registry
 */
export function getAllServerActionIds(): string[] {
  const actions = ToolPluginRegistry.getAllActions();
  return actions.map((action) => action.id);
}
