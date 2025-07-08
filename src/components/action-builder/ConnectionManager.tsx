"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";
import { type ActionConnection, NodeType } from "./types";
import { useActionBuilder } from "./useActionBuilder";

interface ConnectionManagerProps {
  selectedConnection?: string;
  onUpdate?: (connectionId: string, data: Partial<ActionConnection>) => void;
}

export function ConnectionManager({
  selectedConnection,
  onUpdate,
}: ConnectionManagerProps) {
  const { nodes, connections, updateConnection, deleteConnection } =
    useActionBuilder();

  const connection = React.useMemo(
    () => connections.find((c) => c.id === selectedConnection),
    [connections, selectedConnection],
  );

  const sourceNode = React.useMemo(
    () => nodes.find((n) => n.id === connection?.source),
    [nodes, connection],
  );

  const targetNode = React.useMemo(
    () => nodes.find((n) => n.id === connection?.target),
    [nodes, connection],
  );

  if (!connection || !sourceNode || !targetNode) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground text-sm">
            Select a connection to configure
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleTypeChange = (type: "success" | "failure" | "always") => {
    updateConnection(connection.id, { type });
    onUpdate?.(connection.id, { type });
  };

  const handleConditionChange = (condition: string) => {
    updateConnection(connection.id, {
      data: { ...connection.data, condition },
    });
    onUpdate?.(connection.id, {
      data: { ...connection.data, condition },
    });
  };

  const handleTransformerChange = (transformer: string) => {
    updateConnection(connection.id, {
      data: { ...connection.data, transformer },
    });
    onUpdate?.(connection.id, {
      data: { ...connection.data, transformer },
    });
  };

  const handleDelete = () => {
    deleteConnection(connection.id);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Connection Configuration</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{sourceNode.data.label}</Badge>
            <span className="text-muted-foreground">→</span>
            <Badge variant="outline">{targetNode.data.label}</Badge>
          </div>
        </div>

        {/* Connection Type (for condition nodes) */}
        {sourceNode.type === NodeType.CONDITION && (
          <div className="space-y-2">
            <Label>Connection Type</Label>
            <Select
              value={connection.type ?? "always"}
              onValueChange={(value) =>
                handleTypeChange(value as "success" | "failure" | "always")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="success">On Success</SelectItem>
                <SelectItem value="failure">On Failure</SelectItem>
                <SelectItem value="always">Always</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Condition Configuration */}
        {connection.type !== "always" && (
          <div className="space-y-2">
            <Label>Condition Expression</Label>
            <Textarea
              placeholder="e.g., output.status === 'success'"
              value={connection.data?.condition ?? ""}
              onChange={(e) => handleConditionChange(e.target.value)}
              className="font-mono text-sm"
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              JavaScript expression that evaluates to true/false
            </p>
          </div>
        )}

        {/* Data Transformer */}
        <div className="space-y-2">
          <Label>Data Transformer (Optional)</Label>
          <Textarea
            placeholder="e.g., { message: input.text, timestamp: new Date() }"
            value={connection.data?.transformer ?? ""}
            onChange={(e) => handleTransformerChange(e.target.value)}
            className="font-mono text-sm"
            rows={4}
          />
          <p className="text-muted-foreground text-xs">
            Transform data before passing to the next node
          </p>
        </div>

        {/* Field Mapping */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Field Mapping</Label>
            <Button variant="outline" size="sm">
              <Plus className="mr-1 h-3 w-3" />
              Add Mapping
            </Button>
          </div>
          <div className="text-muted-foreground rounded border border-dashed p-4 text-center text-sm">
            Field mapping coming soon...
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
