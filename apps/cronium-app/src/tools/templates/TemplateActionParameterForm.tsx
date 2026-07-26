"use client";

import React from "react";
import { z } from "zod";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Textarea } from "@cronium/ui";
import { Switch } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Alert, AlertDescription } from "@cronium/ui";
import { AlertTriangle } from "lucide-react";
import { type ToolAction } from "@/tools/types/tool-plugin";
import { MonacoEditor } from "@cronium/ui";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import {
  collectParameterErrors,
  formatEnumValue,
  formatFieldName,
  formatFieldValueForEditor,
  getEnumOptions,
  getMonacoLanguage,
  getSchemaShape,
  isEmailField,
  isMultilineField,
  parseLooseFieldValue,
  parseMonacoFieldValue,
  shouldUseMonaco,
  unwrapOptionalSchema,
} from "./lib/parameter-fields";

interface TemplateActionParameterFormProps {
  action: ToolAction;
  value: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  onFieldFocus?: (fieldName: string | null) => void;
  disabled?: boolean;
}

export function TemplateActionParameterForm({
  action,
  value,
  onChange,
  onFieldFocus,
  disabled = false,
}: TemplateActionParameterFormProps) {
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = React.useState<Set<string>>(
    new Set(),
  );

  // Fetch editor settings for Monaco
  const { data: editorSettings } = trpc.settings.getEditorSettings.useQuery(
    undefined,
    {
      ...QUERY_OPTIONS.static,
    },
  );

  // Get schema shape from Zod schema
  const schemaShape: Record<string, z.ZodTypeAny> = getSchemaShape(
    action.inputSchema,
  );

  // Handle field change
  const handleFieldChange = (key: string, fieldValue: unknown) => {
    const newValue = { ...value, [key]: fieldValue };
    onChange(newValue);

    // Clear error for this field
    if (errors[key]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  // Handle field focus
  const handleFieldFocus = (key: string) => {
    onFieldFocus?.(key);
  };

  // Handle field blur
  const handleFieldBlur = (key: string) => {
    setTouchedFields((prev) => new Set(prev).add(key));
    onFieldFocus?.(null);
  };

  // Validate all fields
  React.useEffect(() => {
    if (action.inputSchema) {
      setErrors(collectParameterErrors(action.inputSchema, value));
    }
  }, [value, action.inputSchema]);

  // Render field based on Zod type
  const renderField = (key: string, schema: z.ZodTypeAny) => {
    const fieldValue = value[key];
    const error = touchedFields.has(key) ? errors[key] : undefined;

    // Get the base type and check if optional
    const { baseSchema, isOptional } = unwrapOptionalSchema(schema);

    // Get description from schema
    const description = (baseSchema as { description?: string }).description;

    // Check if should use Monaco editor
    if (shouldUseMonaco(key, baseSchema)) {
      const language = getMonacoLanguage(key, baseSchema);

      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>
          <div
            className="border-border rounded-md border"
            onFocus={() => handleFieldFocus(key)}
            onBlur={() => handleFieldBlur(key)}
          >
            <MonacoEditor
              value={formatFieldValueForEditor(fieldValue)}
              onChange={(newValue) => {
                handleFieldChange(
                  key,
                  parseMonacoFieldValue(language, newValue),
                );
              }}
              language={language}
              height="200px"
              editorSettings={
                (editorSettings && "data" in editorSettings
                  ? editorSettings.data
                  : editorSettings) ?? {
                  fontSize: 14,
                  theme: "vs-dark",
                  wordWrap: true,
                  minimap: false,
                  lineNumbers: true,
                }
              }
              readOnly={disabled}
            />
          </div>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      );
    }

    // Render based on type
    if (baseSchema instanceof z.ZodString) {
      // Check if it's an email field
      if (isEmailField(key, baseSchema)) {
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>
              {formatFieldName(key)}
              {!isOptional && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={key}
              type="email"
              value={(fieldValue as string) ?? ""}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              onFocus={() => handleFieldFocus(key)}
              onBlur={() => handleFieldBlur(key)}
              disabled={disabled}
              placeholder={
                description ?? `Enter ${formatFieldName(key).toLowerCase()}`
              }
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        );
      }

      // Check if it's a multiline field
      if (isMultilineField(key)) {
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>
              {formatFieldName(key)}
              {!isOptional && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Textarea
              id={key}
              value={(fieldValue as string) ?? ""}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              onFocus={() => handleFieldFocus(key)}
              onBlur={() => handleFieldBlur(key)}
              disabled={disabled}
              placeholder={
                description ?? `Enter ${formatFieldName(key).toLowerCase()}`
              }
              rows={4}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        );
      }

      // Default string input
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Input
            id={key}
            type="text"
            value={(fieldValue as string) ?? ""}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            onFocus={() => handleFieldFocus(key)}
            onBlur={() => handleFieldBlur(key)}
            disabled={disabled}
            placeholder={
              description ?? `Enter ${formatFieldName(key).toLowerCase()}`
            }
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      );
    }

    if (baseSchema instanceof z.ZodNumber) {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Input
            id={key}
            type="number"
            value={(fieldValue as number) ?? ""}
            onChange={(e) => handleFieldChange(key, parseFloat(e.target.value))}
            onFocus={() => handleFieldFocus(key)}
            onBlur={() => handleFieldBlur(key)}
            disabled={disabled}
            placeholder={description ?? "0"}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      );
    }

    if (baseSchema instanceof z.ZodBoolean) {
      return (
        <div key={key} className="flex items-center justify-between space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Switch
            id={key}
            checked={(fieldValue as boolean) ?? false}
            onCheckedChange={(checked) => handleFieldChange(key, checked)}
            onFocus={() => handleFieldFocus(key)}
            onBlur={() => handleFieldBlur(key)}
            disabled={disabled}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      );
    }

    if (baseSchema instanceof z.ZodEnum) {
      const options = getEnumOptions(baseSchema);
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Select
            value={(fieldValue as string) ?? ""}
            onValueChange={(val) => handleFieldChange(key, val)}
            disabled={disabled}
            onOpenChange={(open) => {
              if (open) handleFieldFocus(key);
              else handleFieldBlur(key);
            }}
          >
            <SelectTrigger id={key}>
              <SelectValue
                placeholder={`Select ${formatFieldName(key).toLowerCase()}`}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatEnumValue(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      );
    }

    // Fallback for other types
    return (
      <div key={key} className="space-y-2">
        <Label htmlFor={key}>
          {formatFieldName(key)}
          {!isOptional && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Textarea
          id={key}
          value={formatFieldValueForEditor(fieldValue)}
          onChange={(e) => {
            handleFieldChange(key, parseLooseFieldValue(e.target.value));
          }}
          onFocus={() => handleFieldFocus(key)}
          onBlur={() => handleFieldBlur(key)}
          disabled={disabled}
          placeholder="Enter data"
          rows={4}
          className="font-mono text-sm"
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Show action description */}
      {action.description && (
        <Alert>
          <AlertDescription>{action.description}</AlertDescription>
        </Alert>
      )}

      {/* Render all fields */}
      <div className="space-y-4">
        {Object.entries(schemaShape).map(([key, schema]) =>
          renderField(key, schema),
        )}
      </div>

      {/* Show validation errors summary */}
      {(() => {
        const touchedErrors = Object.entries(errors).filter(([key]) =>
          touchedFields.has(key),
        );
        return touchedErrors.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Please fix the errors above before proceeding.
            </AlertDescription>
          </Alert>
        ) : null;
      })()}
    </div>
  );
}
