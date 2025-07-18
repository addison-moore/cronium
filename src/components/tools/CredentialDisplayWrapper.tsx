"use client";

import React from "react";
import { type Tool } from "@/shared/schema";
import { ToolHealthIndicator } from "./ToolHealthIndicator";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";

interface CredentialDisplayWrapperProps {
  tool: Tool;
  children: React.ReactNode;
  onEdit: (tool: Tool) => void;
  onDelete: (id: number) => void;
}

export function CredentialDisplayWrapper({
  tool,
  children,
  onEdit,
  onDelete,
}: CredentialDisplayWrapperProps) {
  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-medium">{tool.name}</h4>
            <ToolHealthIndicator
              toolId={tool.id}
              toolName={tool.name}
              className="ml-4"
            />
          </div>
          {children}
        </div>
        <div className="ml-4 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(tool)}>
            <Edit size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDelete(tool.id)}>
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Enhanced credential display that includes health indicators
export function createEnhancedCredentialDisplay(
  OriginalDisplay: React.ComponentType<{
    tools: Tool[];
    onEdit: (tool: Tool) => void;
    onDelete: (id: number) => void;
  }>,
) {
  return function EnhancedCredentialDisplay(props: {
    tools: Tool[];
    onEdit: (tool: Tool) => void;
    onDelete: (id: number) => void;
  }) {
    return (
      <div className="space-y-3">
        {props.tools.map((tool) => (
          <div key={tool.id} className="border-border rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-medium">{tool.name}</h4>
              <ToolHealthIndicator
                toolId={tool.id}
                toolName={tool.name}
                showTestButton={true}
              />
            </div>
            <OriginalDisplay
              tools={[tool]}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
            />
          </div>
        ))}
      </div>
    );
  };
}
