"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Input } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Textarea } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Plus, Trash2, ArrowRight, Code, FileText, Hash } from "lucide-react";
import { type DataMapping } from "./types";

interface DataMapperProps {
  sourceName: string;
  targetName: string;
  sourceSchema?: Record<string, unknown>;
  targetSchema?: Record<string, unknown>;
  mappings: DataMapping[];
  onMappingsChange: (mappings: DataMapping[]) => void;
}

export function DataMapper({
  sourceName,
  targetName,
  sourceSchema = {},
  targetSchema = {},
  mappings,
  onMappingsChange,
}: DataMapperProps) {
  const [selectedMapping, setSelectedMapping] = React.useState<number | null>(
    null,
  );

  const sourceFields = React.useMemo(() => {
    return Object.keys(sourceSchema).map((key) => ({
      name: key,
      type: typeof sourceSchema[key],
    }));
  }, [sourceSchema]);

  const targetFields = React.useMemo(() => {
    return Object.keys(targetSchema).map((key) => ({
      name: key,
      type: typeof targetSchema[key],
      required:
        (targetSchema[key] as { required?: boolean })?.required ?? false,
    }));
  }, [targetSchema]);

  const addMapping = () => {
    const newMapping: DataMapping = {
      sourceField: "",
      targetField: "",
      transformer: "direct",
    };
    onMappingsChange([...mappings, newMapping]);
    setSelectedMapping(mappings.length);
  };

  const updateMapping = (index: number, updates: Partial<DataMapping>) => {
    const newMappings = [...mappings];
    newMappings[index] = { ...newMappings[index], ...updates } as DataMapping;
    onMappingsChange(newMappings);
  };

  const deleteMapping = (index: number) => {
    const newMappings = mappings.filter((_, i) => i !== index);
    onMappingsChange(newMappings);
    if (selectedMapping === index) {
      setSelectedMapping(null);
    }
  };

  const getFieldIcon = (type: string) => {
    switch (type) {
      case "string":
        return <FileText className="h-3 w-3" />;
      case "number":
        return <Hash className="h-3 w-3" />;
      case "object":
        return <Code className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Mapping</CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{sourceName}</Badge>
          <ArrowRight className="h-4 w-4" />
          <Badge variant="outline">{targetName}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* Mappings List */}
          <div className="space-y-2">
            <div className="mb-2 flex items-center justify-between">
              <Label>Mappings</Label>
              <Button variant="outline" size="sm" onClick={addMapping}>
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>
            <div className="space-y-1">
              {mappings.map((mapping, index) => (
                <div
                  key={index}
                  className={`hover:bg-accent flex cursor-pointer items-center justify-between rounded border p-2 text-sm transition-colors ${
                    selectedMapping === index ? "border-primary bg-accent" : ""
                  }`}
                  onClick={() => setSelectedMapping(index)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono">
                      {mapping.sourceField || "?"}
                    </span>
                    <ArrowRight className="h-3 w-3" />
                    <span className="font-mono">
                      {mapping.targetField || "?"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMapping(index);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {mappings.length === 0 && (
                <div className="text-muted-foreground py-4 text-center text-sm">
                  No mappings defined
                </div>
              )}
            </div>
          </div>

          {/* Mapping Configuration */}
          <div className="space-y-4">
            {selectedMapping !== null && mappings[selectedMapping] && (
              <>
                <div className="space-y-2">
                  <Label>Source Field</Label>
                  <Select
                    value={mappings[selectedMapping].sourceField}
                    onValueChange={(value) =>
                      updateMapping(selectedMapping, { sourceField: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select source field" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceFields.map((field) => (
                        <SelectItem key={field.name} value={field.name}>
                          <div className="flex items-center gap-2">
                            {getFieldIcon(field.type)}
                            <span>{field.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Target Field</Label>
                  <Select
                    value={mappings[selectedMapping].targetField}
                    onValueChange={(value) =>
                      updateMapping(selectedMapping, { targetField: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select target field" />
                    </SelectTrigger>
                    <SelectContent>
                      {targetFields.map((field) => (
                        <SelectItem key={field.name} value={field.name}>
                          <div className="flex items-center gap-2">
                            {getFieldIcon(field.type)}
                            <span>{field.name}</span>
                            {field.required && (
                              <Badge variant="secondary" className="text-xs">
                                Required
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Transformer</Label>
                  <Select
                    value={mappings[selectedMapping].transformer ?? "direct"}
                    onValueChange={(value) => {
                      const transformer = value as DataMapping["transformer"];
                      if (transformer) {
                        updateMapping(selectedMapping, { transformer });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct">Direct (Copy)</SelectItem>
                      <SelectItem value="template">Template</SelectItem>
                      <SelectItem value="expression">Expression</SelectItem>
                      <SelectItem value="custom">Custom Function</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {mappings[selectedMapping]?.transformer === "template" && (
                  <div className="space-y-2">
                    <Label>Template</Label>
                    <Input
                      placeholder="e.g., Hello {{name}}!"
                      value={
                        mappings[selectedMapping]?.transformerConfig
                          ?.template ?? ""
                      }
                      onChange={(e) =>
                        updateMapping(selectedMapping, {
                          transformerConfig: {
                            ...mappings[selectedMapping]?.transformerConfig,
                            template: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                )}

                {mappings[selectedMapping]?.transformer === "expression" && (
                  <div className="space-y-2">
                    <Label>Expression</Label>
                    <Textarea
                      placeholder="e.g., value.toUpperCase()"
                      value={
                        mappings[selectedMapping]?.transformerConfig
                          ?.expression ?? ""
                      }
                      onChange={(e) =>
                        updateMapping(selectedMapping, {
                          transformerConfig: {
                            ...mappings[selectedMapping]?.transformerConfig,
                            expression: e.target.value,
                          },
                        })
                      }
                      className="font-mono text-sm"
                      rows={3}
                    />
                  </div>
                )}

                {mappings[selectedMapping]?.transformer === "custom" && (
                  <div className="space-y-2">
                    <Label>Custom Function</Label>
                    <Textarea
                      placeholder="function transform(value, context) {
  return value;
}"
                      value={
                        mappings[selectedMapping]?.transformerConfig
                          ?.customFunction ?? ""
                      }
                      onChange={(e) =>
                        updateMapping(selectedMapping, {
                          transformerConfig: {
                            ...mappings[selectedMapping]?.transformerConfig,
                            customFunction: e.target.value,
                          },
                        })
                      }
                      className="font-mono text-sm"
                      rows={5}
                    />
                  </div>
                )}
              </>
            )}
            {selectedMapping === null && (
              <div className="text-muted-foreground py-8 text-center text-sm">
                Select a mapping to configure
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
