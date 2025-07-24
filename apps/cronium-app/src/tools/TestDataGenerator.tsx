"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Alert, AlertDescription } from "@cronium/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cronium/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import { z } from "zod";
import { faker } from "@faker-js/faker";
import {
  TestTube,
  Copy,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Download,
  Upload,
  Sparkles,
  Database,
  FileJson,
} from "lucide-react";
import { type ToolAction } from "@/tools/types/tool-plugin";
import { cn } from "@/lib/utils";

export interface TestDataGeneratorProps {
  action: ToolAction;
  onApply: (data: Record<string, unknown>) => void;
  currentValue?: Record<string, unknown>;
}

interface TestDataSet {
  name: string;
  description: string;
  data: Record<string, unknown>;
  tags: string[];
}

// Common test data patterns
const TEST_DATA_PATTERNS = {
  email: () => faker.internet.email(),
  url: () => faker.internet.url(),
  name: () => faker.person.fullName(),
  firstName: () => faker.person.firstName(),
  lastName: () => faker.person.lastName(),
  phone: () => faker.phone.number(),
  address: () => faker.location.streetAddress(),
  city: () => faker.location.city(),
  country: () => faker.location.country(),
  company: () => faker.company.name(),
  jobTitle: () => faker.person.jobTitle(),
  description: () => faker.lorem.paragraph(),
  message: () => faker.lorem.sentences(2),
  subject: () => faker.lorem.sentence(),
  title: () => faker.lorem.words(3),
  content: () => faker.lorem.paragraphs(2),
  date: () => faker.date.future().toISOString(),
  timestamp: () => faker.date.recent().toISOString(),
  price: () => faker.commerce.price(),
  quantity: () => faker.number.int({ min: 1, max: 100 }),
  id: () => faker.string.uuid(),
  username: () => faker.internet.username(),
  password: () => faker.internet.password(),
  apiKey: () => faker.string.alphanumeric(32),
  webhook: () => `${faker.internet.url()}/webhook`,
  json: () => ({
    key: "value",
    nested: { field: "data" },
    array: [1, 2, 3],
  }),
};

export default function TestDataGenerator({
  action,
  onApply,
}: TestDataGeneratorProps) {
  const [generatedData, setGeneratedData] = useState<TestDataSet[]>([]);
  const [selectedDataSet, setSelectedDataSet] = useState<TestDataSet | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Generate test data based on schema
  const generateTestData = (schema: z.ZodTypeAny): unknown => {
    if (schema instanceof z.ZodString) {
      // Try to match field patterns
      const schemaDescription = schema._def.description?.toLowerCase() ?? "";

      for (const [pattern, generator] of Object.entries(TEST_DATA_PATTERNS)) {
        if (schemaDescription.includes(pattern)) {
          return generator();
        }
      }

      // Check for specific validations
      if (schema._def.checks?.some((check) => check.kind === "email")) {
        return TEST_DATA_PATTERNS.email();
      }
      if (schema._def.checks?.some((check) => check.kind === "url")) {
        return TEST_DATA_PATTERNS.url();
      }

      // Default string
      return faker.lorem.words(3);
    }

    if (schema instanceof z.ZodNumber) {
      const checks = schema._def.checks || [];
      const minCheck = checks.find((check) => check.kind === "min");
      const maxCheck = checks.find((check) => check.kind === "max");

      const min = minCheck ? minCheck.value : 0;
      const max = maxCheck ? maxCheck.value : 1000;

      return faker.number.int({ min, max });
    }

    if (schema instanceof z.ZodBoolean) {
      return faker.datatype.boolean();
    }

    if (schema instanceof z.ZodArray) {
      const itemSchema = schema._def.type as z.ZodTypeAny;
      const length = faker.number.int({ min: 1, max: 5 });
      return Array.from({ length }, () => generateTestData(itemSchema));
    }

    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodTypeAny>;
      const result: Record<string, unknown> = {};

      for (const [key, fieldSchema] of Object.entries(shape)) {
        if (!fieldSchema.isOptional() || faker.datatype.boolean()) {
          result[key] = generateTestData(fieldSchema);
        }
      }

      return result;
    }

    if (schema instanceof z.ZodEnum) {
      const values = schema._def.values as string[];
      return faker.helpers.arrayElement(values);
    }

    if (schema instanceof z.ZodDate) {
      return faker.date.future().toISOString();
    }

    // Default fallback
    return null;
  };

  // Generate multiple test data sets
  const generateDataSets = () => {
    setIsGenerating(true);

    try {
      const sets: TestDataSet[] = [];

      // Generate based on action examples if available
      if (action.examples && action.examples.length > 0) {
        action.examples.forEach((example) => {
          sets.push({
            name: example.name,
            description: example.description,
            data: example.input,
            tags: ["example", "official"],
          });
        });
      }

      // Generate random data sets
      const scenarios = [
        { name: "Basic Test", tags: ["basic", "minimal"] },
        { name: "Full Test", tags: ["complete", "all-fields"] },
        { name: "Edge Case", tags: ["edge", "boundary"] },
        { name: "Real-world", tags: ["realistic", "production"] },
      ];

      scenarios.forEach((scenario) => {
        const data: Record<string, unknown> = {};

        if (action.inputSchema instanceof z.ZodObject) {
          const shape = action.inputSchema.shape as Record<
            string,
            z.ZodTypeAny
          >;

          for (const [fieldName, fieldSchema] of Object.entries(shape)) {
            // For basic test, only include required fields
            if (scenario.tags.includes("minimal") && fieldSchema.isOptional()) {
              continue;
            }

            // For edge case, use boundary values
            if (scenario.tags.includes("edge")) {
              if (fieldSchema instanceof z.ZodString) {
                const checks = fieldSchema._def.checks || [];
                const minCheck = checks.find((c) => c.kind === "min");
                const maxCheck = checks.find((c) => c.kind === "max");

                if (minCheck) {
                  data[fieldName] = faker.string.alpha(minCheck.value);
                } else if (maxCheck) {
                  data[fieldName] = faker.string.alpha(maxCheck.value);
                } else {
                  data[fieldName] = "";
                }
              } else if (fieldSchema instanceof z.ZodNumber) {
                data[fieldName] = 0;
              } else if (fieldSchema instanceof z.ZodArray) {
                data[fieldName] = [];
              } else {
                data[fieldName] = generateTestData(fieldSchema);
              }
            } else {
              // Generate field-specific test data
              const fieldNameLower = fieldName.toLowerCase();
              let generated = false;

              for (const [pattern, generator] of Object.entries(
                TEST_DATA_PATTERNS,
              )) {
                if (fieldNameLower.includes(pattern)) {
                  data[fieldName] = generator();
                  generated = true;
                  break;
                }
              }

              if (!generated) {
                data[fieldName] = generateTestData(fieldSchema);
              }
            }
          }
        }

        sets.push({
          name: scenario.name,
          description: `${scenario.name} data for ${action.name}`,
          data,
          tags: scenario.tags,
        });
      });

      setGeneratedData(sets);
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy data to clipboard
  const copyToClipboard = async (
    data: Record<string, unknown>,
    index: number,
  ) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  // Export all test data
  const exportTestData = () => {
    const exportData = {
      action: action.name,
      generated: new Date().toISOString(),
      datasets: generatedData,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${action.id}-test-data.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import test data
  const importTestData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string) as {
          datasets?: unknown;
        };
        if (imported.datasets && Array.isArray(imported.datasets)) {
          setGeneratedData(imported.datasets as TestDataSet[]);
        }
      } catch (error) {
        console.error("Failed to import:", error);
      }
    };
    reader.readAsText(file);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Test Data Generator
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => document.getElementById("import-data")?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <input
              id="import-data"
              type="file"
              accept=".json"
              className="hidden"
              onChange={importTestData}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={exportTestData}
              disabled={generatedData.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button
              size="sm"
              onClick={generateDataSets}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Generate
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {generatedData.length === 0 ? (
          <div className="py-8 text-center">
            <Database className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <p className="text-muted-foreground mb-4">
              No test data generated yet.
            </p>
            <Button onClick={generateDataSets} disabled={isGenerating}>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Test Data
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="list" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="list">Test Data Sets</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="space-y-4">
              <ScrollArea className="h-[400px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {generatedData.map((dataSet, index) => (
                      <TableRow
                        key={index}
                        className={cn(
                          "hover:bg-muted/50 cursor-pointer",
                          selectedDataSet === dataSet && "bg-muted",
                        )}
                        onClick={() => setSelectedDataSet(dataSet)}
                      >
                        <TableCell className="font-medium">
                          {dataSet.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {dataSet.description}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {dataSet.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyToClipboard(dataSet.data, index);
                              }}
                            >
                              {copiedIndex === index ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={(e) => {
                                e.stopPropagation();
                                onApply(dataSet.data);
                              }}
                            >
                              Apply
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="preview" className="space-y-4">
              {selectedDataSet ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-1 font-medium">{selectedDataSet.name}</h4>
                    <p className="text-muted-foreground text-sm">
                      {selectedDataSet.description}
                    </p>
                  </div>

                  <div className="border-border bg-muted/30 rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileJson className="text-muted-foreground h-4 w-4" />
                        <span className="text-sm font-medium">JSON Data</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          copyToClipboard(selectedDataSet.data, -1)
                        }
                      >
                        {copiedIndex === -1 ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <ScrollArea className="h-[300px]">
                      <pre className="text-sm">
                        <code>
                          {JSON.stringify(selectedDataSet.data, null, 2)}
                        </code>
                      </pre>
                    </ScrollArea>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedDataSet(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        onApply(selectedDataSet.data);
                        setSelectedDataSet(null);
                      }}
                    >
                      Apply Test Data
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Select a test data set from the list to preview.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
