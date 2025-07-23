import { templateProcessor, type TemplateContext } from "./template-processor";

export interface ToolActionTemplateData {
  parameters: Record<string, unknown>;
}

/**
 * Process tool action template parameters
 * Replaces template variables in all string values within the parameters object
 */
export function processToolActionTemplate(
  templateData: ToolActionTemplateData,
  context: TemplateContext,
): ToolActionTemplateData {
  const processedParameters = processParametersRecursively(
    templateData.parameters,
    context,
  );

  return {
    parameters: processedParameters,
  };
}

/**
 * Recursively process parameters object, replacing template variables in string values
 */
function processParametersRecursively(
  params: Record<string, unknown>,
  context: TemplateContext,
): Record<string, unknown> {
  const processed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      // Process string values with template processor
      processed[key] = templateProcessor.processTemplate(value, context);
    } else if (Array.isArray(value)) {
      // Process arrays recursively
      processed[key] = value.map((item) => {
        if (typeof item === "string") {
          return templateProcessor.processTemplate(item, context);
        } else if (typeof item === "object" && item !== null) {
          return processParametersRecursively(
            item as Record<string, unknown>,
            context,
          );
        }
        return item as unknown;
      });
    } else if (typeof value === "object" && value !== null) {
      // Process nested objects recursively
      processed[key] = processParametersRecursively(
        value as Record<string, unknown>,
        context,
      );
    } else {
      // Keep other types (numbers, booleans, null) as-is
      processed[key] = value;
    }
  }

  return processed;
}

/**
 * Validate that template parameters match the expected schema
 * This is a simple validation that checks required fields are present
 */
export function validateTemplateParameters(
  parameters: Record<string, unknown>,
  requiredFields: string[],
): { isValid: boolean; missingFields: string[] } {
  const missingFields = requiredFields.filter(
    (field) => !(field in parameters) || parameters[field] === undefined,
  );

  return {
    isValid: missingFields.length === 0,
    missingFields,
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
