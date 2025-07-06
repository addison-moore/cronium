"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Variable } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";

interface UserVariable {
  id: number;
  key: string;
  value: string;
  description?: string | null;
  userId?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export function VariablesTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<UserVariable | null>(
    null,
  );
  const [formData, setFormData] = useState({
    key: "",
    value: "",
    description: "",
  });
  const { toast } = useToast();

  // tRPC queries and mutations
  const {
    data: variablesData,
    isLoading,
    refetch: refetchVariables,
  } = trpc.admin.getVariables.useQuery({
    limit: 100,
    offset: 0,
  });

  const createVariableMutation = trpc.admin.createVariable.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Variable created successfully",
      });
      setDialogOpen(false);
      setEditingVariable(null);
      setFormData({ key: "", value: "", description: "" });
      void refetchVariables();
    },
  });

  const updateVariableMutation = trpc.admin.updateVariable.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Variable updated successfully",
      });
      setDialogOpen(false);
      setEditingVariable(null);
      setFormData({ key: "", value: "", description: "" });
      void refetchVariables();
    },
  });

  const deleteVariableMutation = trpc.admin.deleteVariable.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Variable deleted successfully",
      });
      void refetchVariables();
    },
  });

  const variables = variablesData?.variables ?? [];

  const handleSaveVariable = async () => {
    if (!formData.key.trim() || !formData.value.trim()) {
      toast({
        title: "Error",
        description: "Key and value are required",
        variant: "destructive",
      });
      return;
    }

    if (editingVariable) {
      updateVariableMutation.mutate({
        id: editingVariable.id,
        ...formData,
      });
    } else {
      createVariableMutation.mutate(formData);
    }
  };

  const handleEditVariable = (variable: UserVariable) => {
    setEditingVariable(variable);
    setFormData({
      key: variable.key,
      value: variable.value,
      description: variable.description ?? "",
    });
    setDialogOpen(true);
  };

  const handleDeleteVariable = async (variableId: number) => {
    if (!confirm("Are you sure you want to delete this variable?")) {
      return;
    }

    deleteVariableMutation.mutate({ id: variableId });
  };

  const handleNewVariable = () => {
    setEditingVariable(null);
    setFormData({ key: "", value: "", description: "" });
    setDialogOpen(true);
  };

  const isSubmitting =
    createVariableMutation.isPending || updateVariableMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Variable className="h-5 w-5" />
            <div>
              <CardTitle>Variables</CardTitle>
              <CardDescription>
                Manage key-value pairs accessible via cronium.getVariable() and
                cronium.setVariable()
              </CardDescription>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleNewVariable}>
                <Plus className="mr-2 h-4 w-4" />
                Add Variable
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingVariable ? "Edit Variable" : "Add New Variable"}
                </DialogTitle>
                <DialogDescription>
                  Create or modify a variable that can be accessed in your
                  scripts
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
                    placeholder="e.g., api_endpoint, max_retries"
                    disabled={!!editingVariable} // Don't allow editing key for existing variables
                  />
                </div>
                <div>
                  <Label htmlFor="value">Value</Label>
                  <Input
                    id="value"
                    value={formData.value}
                    onChange={(e) =>
                      setFormData({ ...formData, value: e.target.value })
                    }
                    placeholder="Variable value"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="What is this variable used for?"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveVariable} disabled={isSubmitting}>
                  {isSubmitting
                    ? "Saving..."
                    : editingVariable
                      ? "Update"
                      : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center">Loading variables...</div>
        ) : variables.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            <Variable className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No variables configured</p>
            <p className="text-sm">
              Variables allow you to store values that can be accessed in your
              scripts
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variables.map((variable) => (
                <TableRow key={variable.id}>
                  <TableCell className="font-mono font-medium">
                    {variable.key}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {variable.value}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {variable.description ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(variable.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditVariable(variable)}
                        disabled={deleteVariableMutation.isPending}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteVariable(variable.id)}
                        disabled={deleteVariableMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
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
  );
}
