/**
 * Pure template-form assembly logic extracted from ToolActionTemplateForm.
 *
 * No React / tRPC imports — everything here is directly unit-testable.
 */

export interface TemplateVariable {
  name: string;
  description: string;
}

export interface TemplateVariableGroup {
  group: string;
  variables: TemplateVariable[];
}

// Template variables available in cronium context
export const TEMPLATE_VARIABLES: TemplateVariableGroup[] = [
  {
    group: "Event",
    variables: [
      { name: "cronium.event.id", description: "Event ID" },
      { name: "cronium.event.name", description: "Event name" },
      { name: "cronium.event.status", description: "Execution status" },
      {
        name: "cronium.event.duration",
        description: "Runtime in milliseconds",
      },
      { name: "cronium.event.executionTime", description: "Start timestamp" },
      { name: "cronium.event.server", description: "Execution server name" },
      { name: "cronium.event.output", description: "Script output" },
      { name: "cronium.event.error", description: "Error message if any" },
    ],
  },
  {
    group: "Variables",
    variables: [
      { name: "cronium.getVariables.*", description: "User-defined variables" },
    ],
  },
  {
    group: "Input",
    variables: [
      { name: "cronium.input.*", description: "Workflow input data" },
    ],
  },
  {
    group: "Conditions",
    variables: [
      { name: "cronium.getCondition.*", description: "Conditional flags" },
    ],
  },
];

/**
 * Append a `{{variable}}` placeholder to the current value of a parameter
 * field, returning a new parameters object (the input is not mutated).
 *
 * Mirrors the historical in-component behavior exactly: a missing/nullish
 * field starts from "", and a non-string current value is string-coerced by
 * the `+` concatenation (e.g. an object becomes "[object Object]{{...}}").
 */
export function appendTemplateVariable(
  parameters: Record<string, unknown>,
  fieldKey: string,
  variableName: string,
): Record<string, unknown> {
  // Get current value of the field
  const currentValue = (parameters[fieldKey] as string) ?? "";

  // Insert the variable wrapped in handlebars syntax
  const newValue = currentValue + `{{${variableName}}}`;

  return {
    ...parameters,
    [fieldKey]: newValue,
  };
}
