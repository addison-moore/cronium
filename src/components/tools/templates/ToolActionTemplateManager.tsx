"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import {
  Plus,
  Edit,
  Trash2,
  Copy,
  Search,
  Filter,
  FileText,
} from "lucide-react";
import { ToolActionTemplateForm } from "./ToolActionTemplateForm";
import { Skeleton } from "@/components/ui/skeleton";

// Tool types - matching what we have in the system
const TOOL_TYPES = [
  { value: "DISCORD", label: "Discord" },
  { value: "SLACK", label: "Slack" },
  { value: "EMAIL", label: "Email" },
  { value: "TEAMS", label: "Microsoft Teams" },
  { value: "NOTION", label: "Notion" },
  { value: "TRELLO", label: "Trello" },
];

export function ToolActionTemplateManager() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedToolType, setSelectedToolType] = useState<string>("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null);

  // Fetch user templates
  const { data: userTemplatesData, isLoading: isLoadingUser } =
    trpc.toolActionTemplates.getUserTemplates.useQuery({
      limit: 100,
      offset: 0,
    });

  // Fetch system templates
  const { data: systemTemplatesData, isLoading: isLoadingSystem } =
    trpc.toolActionTemplates.getSystemTemplates.useQuery({
      toolType: selectedToolType || undefined,
      limit: 100,
      offset: 0,
    });

  // Delete mutation
  const deleteMutation = trpc.toolActionTemplates.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Template deleted",
        description: "The template has been deleted successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete template",
        variant: "destructive",
      });
    },
  });

  // Clone mutation
  const cloneMutation = trpc.toolActionTemplates.clone.useMutation({
    onSuccess: () => {
      toast({
        title: "Template cloned",
        description: "The template has been cloned successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clone template",
        variant: "destructive",
      });
    },
  });

  const utils = trpc.useUtils();

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this template?")) {
      await deleteMutation.mutateAsync({ id });
      await utils.toolActionTemplates.getUserTemplates.invalidate();
    }
  };

  const handleClone = async (templateId: number, name: string) => {
    const newName = prompt(
      "Enter a name for the cloned template:",
      `Copy of ${name}`,
    );
    if (newName) {
      await cloneMutation.mutateAsync({ templateId, newName });
      await utils.toolActionTemplates.getUserTemplates.invalidate();
    }
  };

  // Filter templates based on search and tool type
  const filterTemplates = (
    templates: NonNullable<typeof userTemplatesData>["templates"] | undefined,
  ) => {
    if (!templates) return [];

    return templates.filter((template) => {
      const matchesSearch = searchQuery
        ? template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (template.description
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ??
            false)
        : true;

      const matchesToolType = selectedToolType
        ? template.toolType === selectedToolType
        : true;

      return matchesSearch && matchesToolType;
    });
  };

  const filteredUserTemplates = filterTemplates(userTemplatesData?.templates);
  const filteredSystemTemplates = filterTemplates(
    systemTemplatesData?.templates,
  );

  const isLoading = isLoadingUser || isLoadingSystem;

  return (
    <div className="space-y-6">
      {/* Search and Filter Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select
                value={selectedToolType}
                onValueChange={setSelectedToolType}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All tools" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All tools</SelectItem>
                  {TOOL_TYPES.map((tool) => (
                    <SelectItem key={tool.value} value={tool.value}>
                      {tool.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New Template
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Form */}
      {(showCreateForm || editingTemplate) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingTemplate ? "Edit Template" : "Create New Template"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ToolActionTemplateForm
              templateId={editingTemplate ?? undefined}
              onSuccess={() => {
                setShowCreateForm(false);
                setEditingTemplate(null);
                utils.toolActionTemplates.getUserTemplates.invalidate();
              }}
              onCancel={() => {
                setShowCreateForm(false);
                setEditingTemplate(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Templates Tabs */}
      <Tabs defaultValue="user" className="space-y-4">
        <TabsList>
          <TabsTrigger value="user">My Templates</TabsTrigger>
          <TabsTrigger value="system">System Templates</TabsTrigger>
        </TabsList>

        {/* User Templates */}
        <TabsContent value="user" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Templates</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filteredUserTemplates?.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center">
                  <FileText className="mx-auto mb-4 h-12 w-12" />
                  <p>No templates found</p>
                  <p className="text-sm">
                    {searchQuery || selectedToolType
                      ? "Try adjusting your filters"
                      : "Create your first template to get started"}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUserTemplates?.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="font-medium">
                          {template.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{template.toolType}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{template.actionId}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate">
                          {template.description || "-"}
                        </TableCell>
                        <TableCell>
                          {new Date(template.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingTemplate(template.id)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleClone(template.id, template.name)
                              }
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(template.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Templates */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Templates</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filteredSystemTemplates?.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center">
                  <FileText className="mx-auto mb-4 h-12 w-12" />
                  <p>No system templates found</p>
                  <p className="text-sm">Try selecting a different tool type</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSystemTemplates?.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="font-medium">
                          {template.name}
                          <Badge variant="outline" className="ml-2">
                            System
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{template.toolType}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{template.actionId}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate">
                          {template.description || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleClone(template.id, template.name)
                            }
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
