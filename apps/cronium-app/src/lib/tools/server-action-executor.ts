import { type z } from "zod";
import { ToolPluginRegistry, initializePlugins } from "@/tools/plugins";

// Ensure plugins are initialized (will check global flag and skip if already done)
initializePlugins();

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
  // Ensure plugins are initialized before lookup
  initializePlugins();

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
  // Ensure plugins are initialized before getting all actions
  initializePlugins();

  const actions = ToolPluginRegistry.getAllActions();
  return actions.map((action) => action.id);
}
