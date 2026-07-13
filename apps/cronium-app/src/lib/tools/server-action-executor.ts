/**
 * Server-side entry point for resolving tool actions.
 *
 * Action resolution is delegated to `server-plugin-actions.ts`, which imports
 * the plugins' action definitions directly. This file previously pulled actions
 * out of `ToolPluginRegistry` via the `@/tools/plugins` barrel, but that barrel
 * imports "use client" plugin modules — on the server they become client
 * reference proxies with no usable actions, so the registry came back empty and
 * every tool action failed with "Action not found".
 */
export {
  getServerActionById,
  getAllServerActionIds,
} from "./server-plugin-actions";

// Execution context passed to a tool action's execute(). Re-defined here (rather
// than imported from tool-plugin.ts) to avoid a circular dependency.
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
