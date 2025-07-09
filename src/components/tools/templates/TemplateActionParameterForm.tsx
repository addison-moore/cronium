"use client";

import React, { useRef } from "react";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { type ToolAction } from "@/components/tools/types/tool-plugin";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

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
  const editorRefs = useRef<Record<string, any>>({});

  // Fetch editor settings for Monaco
  const { data: editorSettings } = trpc.settings.getEditorSettings.useQuery(
    undefined,
    {
      ...QUERY_OPTIONS.static,
    },
  );

  // Get schema shape from Zod schema
  const getSchemaShape = () => {
    if (action.inputSchema instanceof z.ZodObject) {
      return action.inputSchema.shape;
    }
    return {};
  };

  const schemaShape = getSchemaShape();

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
      const result = action.inputSchema.safeParse(value);
      if (!result.success) {
        const newErrors: Record<string, string> = {};
        result.error.errors.forEach((error) => {
          const path = error.path.join(".");
          newErrors[path] = error.message;
        });
        setErrors(newErrors);
      } else {
        setErrors({});
      }
    }
  }, [value, action.inputSchema]);

  // Check if field should use Monaco editor
  const shouldUseMonaco = (key: string, schema: z.ZodTypeAny): boolean => {
    // Check for explicit format hints
    const description =
      (schema as { description?: string }).description?.toLowerCase() || "";
    if (description.includes("json") || description.includes("html")) {
      return true;
    }

    // Check field names
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("json") ||
      lowerKey.includes("html") ||
      lowerKey.includes("blocks") || // Slack blocks
      lowerKey.includes("embeds") || // Discord embeds
      (lowerKey.includes("body") && description.includes("html"))
    ) {
      return true;
    }

    // Check if it's an object or array type
    if (schema instanceof z.ZodObject || schema instanceof z.ZodArray) {
      return true;
    }

    return false;
  };

  // Determine language for Monaco
  const getMonacoLanguage = (
    key: string,
    schema: z.ZodTypeAny,
  ): "html" | "json" => {
    const description =
      (schema as { description?: string }).description?.toLowerCase() || "";
    const lowerKey = key.toLowerCase();

    if (
      lowerKey.includes("html") ||
      (lowerKey.includes("body") && description.includes("html"))
    ) {
      return "html";
    }

    return "json";
  };

  // Render field based on Zod type
  const renderField = (key: string, schema: z.ZodTypeAny) => {
    const fieldValue = value[key];
    const error = touchedFields.has(key) ? errors[key] : undefined;

    // Get the base type and check if optional
    let baseSchema = schema;
    let isOptional = false;

    if (schema instanceof z.ZodOptional) {
      isOptional = true;
      baseSchema = schema._def.innerType;
    }

    // Get description from schema
    const description = (baseSchema as { description?: string }).description;

    // Check if should use Monaco editor
    if (shouldUseMonaco(key, baseSchema)) {
      const language = getMonacoLanguage(key, baseSchema);

      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="ml-1 text-red-500">*</span>}
          </Label>
          <div
            className="rounded-md border"
            onFocus={() => handleFieldFocus(key)}
            onBlur={() => handleFieldBlur(key)}
          >
            <MonacoEditor
              value={
                typeof fieldValue === "object"
                  ? JSON.stringify(fieldValue, null, 2)
                  : String(fieldValue ?? "")
              }
              onChange={(newValue) => {
                if (language === "json") {
                  try {
                    const parsed = JSON.parse(newValue || "{}");
                    handleFieldChange(key, parsed);
                  } catch {
                    handleFieldChange(key, newValue);
                  }
                } else {
                  handleFieldChange(key, newValue);
                }
              }}
              language={language}
              height="200px"
              editorSettings={
                editorSettings ?? {
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
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      );
    }

    // Render based on type
    if (baseSchema instanceof z.ZodString) {
      // Check if it's an email field
      if (
        key.toLowerCase().includes("email") ||
        baseSchema._def.checks?.some(
          (check: { kind: string }) => check.kind === "email",
        )
      ) {
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>
              {formatFieldName(key)}
              {!isOptional && <span className="ml-1 text-red-500">*</span>}
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
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        );
      }

      // Check if it's a multiline field
      if (
        key.toLowerCase().includes("body") ||
        key.toLowerCase().includes("content") ||
        key.toLowerCase().includes("message") ||
        key.toLowerCase().includes("description") ||
        key.toLowerCase().includes("text")
      ) {
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>
              {formatFieldName(key)}
              {!isOptional && <span className="ml-1 text-red-500">*</span>}
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
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        );
      }

      // Default string input
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="ml-1 text-red-500">*</span>}
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
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      );
    }

    if (baseSchema instanceof z.ZodNumber) {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="ml-1 text-red-500">*</span>}
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
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      );
    }

    if (baseSchema instanceof z.ZodBoolean) {
      return (
        <div key={key} className="flex items-center justify-between space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="ml-1 text-red-500">*</span>}
          </Label>
          <Switch
            id={key}
            checked={(fieldValue as boolean) ?? false}
            onCheckedChange={(checked) => handleFieldChange(key, checked)}
            onFocus={() => handleFieldFocus(key)}
            onBlur={() => handleFieldBlur(key)}
            disabled={disabled}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      );
    }

    if (baseSchema instanceof z.ZodEnum) {
      const options = baseSchema._def.values as string[];
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>
            {formatFieldName(key)}
            {!isOptional && <span className="ml-1 text-red-500">*</span>}
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
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      );
    }

    // Fallback for other types
    return (
      <div key={key} className="space-y-2">
        <Label htmlFor={key}>
          {formatFieldName(key)}
          {!isOptional && <span className="ml-1 text-red-500">*</span>}
        </Label>
        <Textarea
          id={key}
          value={
            typeof fieldValue === "object"
              ? JSON.stringify(fieldValue, null, 2)
              : String(fieldValue ?? "")
          }
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              handleFieldChange(key, parsed);
            } catch {
              handleFieldChange(key, e.target.value);
            }
          }}
          onFocus={() => handleFieldFocus(key)}
          onBlur={() => handleFieldBlur(key)}
          disabled={disabled}
          placeholder="Enter data"
          rows={4}
          className="font-mono text-sm"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
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
          renderField(key, schema as z.ZodTypeAny),
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

// Helper functions
function formatFieldName(key: string): string {
  // Convert snake_case or camelCase to Title Case
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatEnumValue(value: string): string {
  // Format enum values for display
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
