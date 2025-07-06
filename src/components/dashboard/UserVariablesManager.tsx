"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Variable } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface UserVariable {
  id: number;
  key: string;
  value: string;
  description?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  userId?: string;
}

export function UserVariablesManager() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<UserVariable | null>(
    null,
  );
  const [formData, setFormData] = useState({
    key: "",
    value: "",
    description: "",
  });
  const { toast } = useToast();
  const { user } = useAuth();

  // tRPC queries and mutations
  const {
    data: variablesData,
    isLoading,
    refetch: refetchVariables,
    error,
  } = trpc.variables.getAll.useQuery(
    {
      limit: 1000,
      offset: 0,
      search: "",
      sortBy: "key",
      sortOrder: "asc",
    },
    {
      enabled: !!user,
      ...QUERY_OPTIONS.dynamic,
    },
  );

  const createVariableMutation = trpc.variables.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Variable created successfully",
      });
      setIsDialogOpen(false);
      setEditingVariable(null);
      setFormData({ key: "", value: "", description: "" });
      void refetchVariables();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to create variable",
        variant: "destructive",
      });
    },
  });

  const updateVariableMutation = trpc.variables.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Variable updated successfully",
      });
      setIsDialogOpen(false);
      setEditingVariable(null);
      setFormData({ key: "", value: "", description: "" });
      void refetchVariables();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to update variable",
        variant: "destructive",
      });
    },
  });

  const deleteVariableMutation = trpc.variables.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Variable deleted successfully",
      });
      void refetchVariables();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to delete variable",
        variant: "destructive",
      });
    },
  });

  const variables = variablesData?.variables ?? [];

  const handleSaveVariable = async () => {
    try {
      if (!formData.key.trim()) {
        toast({
          title: "Error",
          description: "Variable key is required",
          variant: "destructive",
        });
        return;
      }

      if (editingVariable) {
        // Update existing variable
        await updateVariableMutation.mutateAsync({
          id: editingVariable.id,
          value: formData.value,
          description: formData.description ?? undefined,
        });
      } else {
        // Create new variable
        await createVariableMutation.mutateAsync({
          key: formData.key,
          value: formData.value,
          description: formData.description ?? undefined,
        });
      }
    } catch (error) {
      // Additional error handling beyond what's in the mutation callbacks
      console.error("Error saving variable:", error);

      // Display a more specific error message if available
      const errorMessage =
        error instanceof Error
          ? error.message
          : editingVariable
            ? "Failed to update variable"
            : "Failed to create variable";

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleDeleteVariable = async (id: number) => {
    try {
      await deleteVariableMutation.mutateAsync({ id });
    } catch (error) {
      // Additional error handling beyond what's in the mutation callbacks
      console.error("Error deleting variable:", error);

      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete variable",
        variant: "destructive",
      });
    }
  };

  const handleEditVariable = (variable: UserVariable) => {
    setEditingVariable(variable);
    setFormData({
      key: variable.key,
      value: variable.value,
      description: variable.description ?? "",
    });
    setIsDialogOpen(true);
  };

  const handleAddVariable = () => {
    setEditingVariable(null);
    setFormData({ key: "", value: "", description: "" });
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Variable className="h-5 w-5" />
            Variables
          </CardTitle>
          <CardDescription>Loading variables...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Variable className="h-5 w-5" />
              Variables
            </CardTitle>
            <CardDescription>
              Store key-value pairs that can be accessed in your scripts using
              cronium.getVariable()
            </CardDescription>
          </div>
          <Button onClick={handleAddVariable}>
            <Plus className="mr-2 h-4 w-4" />
            Add Variable
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {variables.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            <Variable className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No variables created yet</p>
            <p className="text-sm">Create your first variable to get started</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variables.map((variable) => (
                <TableRow key={variable.id}>
                  <TableCell className="font-mono">{variable.key}</TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono">
                    {variable.value}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {variable.description ?? "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditVariable(variable)}
                        disabled={updateVariableMutation.isPending}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteVariable(variable.id)}
                        className="text-red-600 hover:text-red-700"
                        disabled={deleteVariableMutation.isPending}
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

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingVariable ? "Edit Variable" : "Add Variable"}
            </DialogTitle>
            <DialogDescription>
              {editingVariable
                ? "Update the variable details below."
                : "Create a new variable that can be accessed in your scripts."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="key">Key</Label>
              <Input
                id="key"
                value={formData.key}
                onChange={(e) =>
                  setFormData({ ...formData, key: e.target.value })
                }
                placeholder="e.g., API_URL, DATABASE_NAME"
                disabled={!!editingVariable} // Don't allow editing key for existing variables
              />
            </div>
            <div>
              <Label htmlFor="value">Value</Label>
              <Textarea
                id="value"
                value={formData.value}
                onChange={(e) =>
                  setFormData({ ...formData, value: e.target.value })
                }
                placeholder="Variable value"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="description">Description (Optional)</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Brief description of this variable"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveVariable}
              disabled={
                createVariableMutation.isPending ||
                updateVariableMutation.isPending
              }
            >
              {editingVariable ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-red-700">
            Error: {error.message || "Failed to load variables"}
          </p>
        </div>
      )}
    </Card>
  );
}
