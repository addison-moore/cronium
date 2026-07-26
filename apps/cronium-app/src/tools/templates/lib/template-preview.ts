/**
 * Pure preview-derivation logic extracted from TemplatePreview.
 *
 * No React / tRPC imports — everything here is directly unit-testable.
 */

import { type TemplateContext } from "@/lib/template-processor";

export interface ResolvePreviewContextOptions {
  useCustomContext: boolean;
  customContext: string;
  selectedContext: "success" | "failure";
  successContext: TemplateContext;
  failureContext: TemplateContext;
}

/**
 * Resolve the context object used to render the template preview.
 *
 * Custom-context JSON is only honored when enabled AND non-empty; invalid
 * JSON falls back to the selected sample context (logging the parse error),
 * exactly as the component historically behaved.
 */
export function resolvePreviewContext({
  useCustomContext,
  customContext,
  selectedContext,
  successContext,
  failureContext,
}: ResolvePreviewContextOptions): TemplateContext | Record<string, unknown> {
  if (useCustomContext && customContext) {
    try {
      return JSON.parse(customContext) as Record<string, unknown>;
    } catch (error) {
      console.error("Invalid custom context:", error);
      return selectedContext === "success" ? successContext : failureContext;
    }
  }
  return selectedContext === "success" ? successContext : failureContext;
}

export interface ParameterPreview {
  originalStr: string;
  processedStr: string;
  hasChanged: boolean;
}

/**
 * Derive the side-by-side preview strings for one parameter: the raw template
 * value, the processed value, and whether processing changed anything.
 * Strings pass through; other values are pretty-printed JSON.
 */
export function deriveParameterPreview(
  value: unknown,
  processedValue: unknown,
): ParameterPreview {
  const originalStr =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const processedStr =
    typeof processedValue === "string"
      ? processedValue
      : JSON.stringify(processedValue, null, 2);

  const hasChanged = originalStr !== processedStr;

  return { originalStr, processedStr, hasChanged };
}
