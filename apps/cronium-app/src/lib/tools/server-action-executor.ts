/**
 * Server-side entry point for resolving tool actions.
 *
 * Action resolution is delegated to the single `tool-registry`, which is built
 * from the per-tool manifests (no "use client" boundary). This file previously
 * pulled actions out of `ToolPluginRegistry` via the `@/tools/plugins` barrel,
 * whose "use client" plugin modules became client reference proxies on the
 * server — the registry came back empty and every action failed with "Action
 * not found".
 */
export { getServerActionById, getAllServerActionIds } from "./tool-registry";

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
