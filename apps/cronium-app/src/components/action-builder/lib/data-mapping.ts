/**
 * Pure data-mapping assembly logic extracted from DataMapper: schema-to-field
 * derivation and immutable mapping-list operations, with no React imports.
 */

import { type DataMapping } from "../types";

export interface SourceFieldOption {
  name: string;
  type: string;
}

export interface TargetFieldOption {
  name: string;
  type: string;
  required: boolean;
}

/**
 * Derive selectable source fields from a (loosely-typed) schema object.
 * The "type" is the JS `typeof` of the schema value — for schema objects
 * like `{ required: true }` this is "object", not the field's data type.
 */
export function deriveSourceFields(
  sourceSchema: Record<string, unknown>,
): SourceFieldOption[] {
  return Object.keys(sourceSchema).map((key) => ({
    name: key,
    type: typeof sourceSchema[key],
  }));
}

/** Derive selectable target fields, including the `required` flag. */
export function deriveTargetFields(
  targetSchema: Record<string, unknown>,
): TargetFieldOption[] {
  return Object.keys(targetSchema).map((key) => ({
    name: key,
    type: typeof targetSchema[key],
    required: (targetSchema[key] as { required?: boolean })?.required ?? false,
  }));
}

/** A fresh mapping row: no source/target selected, direct copy. */
export function createEmptyMapping(): DataMapping {
  return {
    sourceField: "",
    targetField: "",
    transformer: "direct",
  };
}

/**
 * Return a copy of the list with `updates` merged into the mapping at
 * `index`. No bounds or type checking (mismatched source/target field types
 * are accepted); an out-of-range index writes a new element consisting of
 * only the updates — preserved from the original in-component behavior.
 */
export function updateMappingAt(
  mappings: DataMapping[],
  index: number,
  updates: Partial<DataMapping>,
): DataMapping[] {
  const newMappings = [...mappings];
  newMappings[index] = { ...newMappings[index], ...updates } as DataMapping;
  return newMappings;
}

/** Return a copy of the list without the mapping at `index`. */
export function removeMappingAt(
  mappings: DataMapping[],
  index: number,
): DataMapping[] {
  return mappings.filter((_, i) => i !== index);
}
