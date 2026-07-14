/**
 * Back-compat shim. Connection-test logic now lives per-tool in each plugin's
 * `connection-test.ts`, dispatched by `@/lib/tools/tool-registry`. This module
 * only re-exports for the remaining (soon-to-be-removed) per-tool routers.
 */
export type { ConnectionTestResult } from "@/lib/tools/connection-test";
export { testToolConnection } from "@/lib/tools/tool-registry";
