import {
  templateProcessor,
  type TemplateContext,
  type TemplateEncoding,
} from "./template-processor";

export interface ToolActionTemplateData {
  parameters: Record<string, unknown>;
}

/** Picks the encoding for a top-level parameter. Nested values inherit it. */
export type ParameterEncoding = (
  name: string,
  parameters: Record<string, unknown>,
) => TemplateEncoding;

function renderValue(
  value: unknown,
  context: TemplateContext,
  encoding: TemplateEncoding,
): unknown {
  if (typeof value === "string") {
    return templateProcessor.processTemplate(value, context, encoding);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, context, encoding));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        renderValue(item, context, encoding),
      ]),
    );
  }
  return value;
}

/**
 * Process tool action template parameters. Replaces template variables in all
 * string values within the parameters object. Values are used verbatim unless the
 * action says a parameter ends up somewhere that needs encoding.
 */
export function processToolActionTemplate(
  templateData: ToolActionTemplateData,
  context: TemplateContext,
  encodingFor: ParameterEncoding = () => "text",
): ToolActionTemplateData {
  const { parameters } = templateData;
  return {
    parameters: Object.fromEntries(
      Object.entries(parameters).map(([name, value]) => [
        name,
        renderValue(value, context, encodingFor(name, parameters)),
      ]),
    ),
  };
}

/**
 * The same rendering for the editor's live preview, where a half-typed tag is the
 * normal case: a parameter that does not compile shows the error in place.
 */
export function previewToolActionTemplate(
  templateData: ToolActionTemplateData,
  context: TemplateContext,
  encodingFor: ParameterEncoding = () => "text",
): ToolActionTemplateData {
  const { parameters } = templateData;
  return {
    parameters: Object.fromEntries(
      Object.entries(parameters).map(([name, value]) => {
        try {
          return [
            name,
            renderValue(value, context, encodingFor(name, parameters)),
          ];
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return [name, `[Template Error: ${message}]\n\n${String(value)}`];
        }
      }),
    ),
  };
}

/**
 * Extract all template variables used in the parameters
 */
export function extractTemplateVariables(
  parameters: Record<string, unknown>,
): string[] {
  const variables = new Set<string>();

  function extractFromValue(value: unknown): void {
    if (typeof value === "string") {
      const extracted = templateProcessor.extractVariables(value);
      extracted.forEach((v) => variables.add(v));
    } else if (Array.isArray(value)) {
      value.forEach(extractFromValue);
    } else if (typeof value === "object" && value !== null) {
      Object.values(value as Record<string, unknown>).forEach(extractFromValue);
    }
  }

  Object.values(parameters).forEach(extractFromValue);
  return Array.from(variables);
}
